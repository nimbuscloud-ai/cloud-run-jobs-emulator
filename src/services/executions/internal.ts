import os from 'os';
import path from 'path';
import { protos } from '@google-cloud/run'
import { NotFound, BadRequest, Conflict, InternalServerError, RequestTimeout } from 'http-errors';

import { docker, streamContainerLogs } from '@utils/docker'
import { Logger, getLogger } from '@utils/logger'
import Dockerode from 'dockerode'
import { getConfig } from '@utils/config';


const nowTimestamp = () => protos.google.protobuf.Timestamp.create({
  seconds: Math.floor(Date.now() / 1000)
});


const executionNamesByJobName = new Map<string, string[]>();
const executionsStore = new Map<string, protos.google.cloud.run.v2.Execution>();
const runningContainersByExecutionName = new Map<string, Dockerode.Container>();

export const executions = {
  list: (jobName: string | '-' = '-') => {
    const logger = getLogger(Logger.Execution);

    logger.debug({ jobName }, 'execution.list');

    if (jobName === '-') {
      return Array.from(executionsStore.values());
    }

    return executionNamesByJobName.get(jobName)?.map(name => executionsStore.get(name)).filter(
      (execution): execution is protos.google.cloud.run.v2.Execution => !!execution
    ) ?? [];
  },
  start: async (job: protos.google.cloud.run.v2.IJob, overrides?: protos.google.cloud.run.v2.RunJobRequest.IOverrides) => {
    const logger = getLogger(Logger.Execution);

    logger.debug({ job, overrides }, 'execution.create');

    if (!job.name) {
      throw new BadRequest('Invalid Job for Execution: name is required');
    }

    if (overrides?.taskCount && overrides.taskCount > 1) {
      logger.warn({ taskCount: overrides.taskCount }, 'taskCount is not yet supported, running only one task');
    }

    const [containerTemplate] = job.template?.template?.containers ?? [];

    if (!containerTemplate || !containerTemplate.image) {
      throw new BadRequest('Invalid Job: template must have at least one container with an image');
    }

    const options: Dockerode.ContainerCreateOptions = {
      Image: containerTemplate.image,
    };

    const config = getConfig();

    if (config.applicationDefaultCredentials) {
      let gcpDirectory = config.applicationDefaultCredentials;

      if (gcpDirectory.split(path.sep).includes('$HOME')) {
        gcpDirectory = gcpDirectory.replace('$HOME', os.homedir());
      }

      options.HostConfig = {
        Binds: [`${gcpDirectory}:/gcp/config:ro`], // Bind the volume with read-only flag
      }
    }

    if (overrides?.containerOverrides) {
      const envOverrides = overrides.containerOverrides.filter(({ env }) => env);

      if (envOverrides.length > 0) {
        options.Env = Object.entries([
          ...(containerTemplate.env ?? []),
          ...envOverrides.flatMap(({ env }) => env ?? []),
        ].reduce(
          (acc, { name, value }) => {
            if (!name || !value) {
              logger.warn({ envVar: name, value }, 'invalid env var');
              return acc;
            }
            
            acc[name] = value;
            return acc;
          },
          {} as Record<string, string>
        )).map(([name, value]) => `${name}=${value}`);
      }

      const clearArgs = overrides.containerOverrides.some(({ clearArgs }) => clearArgs);
      
      if (clearArgs) {
        options.Cmd = [];
      }

      const argsOverrides = overrides.containerOverrides.filter(({ args }) => args);
      if (argsOverrides.length > 0) {
        // last one wins
        options.Cmd = argsOverrides[argsOverrides.length - 1].args ?? [];
      }
    }

    const timeout = Number.parseInt(overrides?.timeout?.seconds?.toString() ?? '600');

    const execution = protos.google.cloud.run.v2.Execution.create({
      name: `${job.name}-${Date.now()}`,
      // todo make sure overrides are applied to template, then to container earlier so they propagate here
      template: job.template?.template,
      createTime: nowTimestamp(),
      updateTime: nowTimestamp(),
    });

    executionsStore.set(execution.name, execution);
    executionNamesByJobName.set(job.name, [...(executionNamesByJobName.get(job.name) ?? []), execution.name]);
    
    logger.debug({ executionName: execution.name }, `creating container for execution ${execution.name}`, { options });
    const container = await docker.createContainer(options);
    runningContainersByExecutionName.set(execution.name, container);

    const startExecution = async () => {
      const waitForCompletion = async () => {
        const { StatusCode } = await container.wait();
    
        if (StatusCode !== 0) {
          throw new InternalServerError(`failed to run execution ${execution.name} for job ${job.name}, container exited with status ${StatusCode}`);
        }
      };

      try {
        let timeoutTimer: NodeJS.Timeout;

        execution.startTime = nowTimestamp();
        execution.updateTime = nowTimestamp();
        execution.runningCount = 1;

        const expiration = new Promise((_, reject) => {
          timeoutTimer = setTimeout(() => {
            execution.expireTime = nowTimestamp();
            execution.updateTime = nowTimestamp();

            reject(new RequestTimeout(`job ${execution.name} timed out after ${timeout} seconds`));
          }, timeout * 1000);
        });

        container.start();
        streamContainerLogs(container, logger, execution.name);

        await Promise.race([
          waitForCompletion()
            .then(() => {
              execution.succeededCount = 1;
              execution.updateTime = nowTimestamp();
            })
            .finally(() => clearTimeout(timeoutTimer)),
          expiration
        ]);

        logger.debug(`execution ${execution.name} for job ${job.name} completed successfully`);

      } catch (err) {
        execution.failedCount = 1;
        execution.updateTime = nowTimestamp();
        logger.error({ err }, `execution ${execution.name} for job ${job.name} failed`);
      } finally {
        execution.runningCount = 0;
        execution.completionTime = nowTimestamp();
        execution.updateTime = nowTimestamp();
      
        const runningContainer = runningContainersByExecutionName.get(execution.name);

        if (runningContainer && (await runningContainer.inspect()).State.Running) {
          await runningContainer.kill();
          await runningContainer.remove();
          runningContainersByExecutionName.delete(execution.name);
        }
      }
    };

    const promise = startExecution();

    return { execution, promise };
  },
  delete: async (name: string) => {
    const logger = getLogger(Logger.Execution);

    logger.debug({ executionName: name }, 'execution.delete');

    const execution = executionsStore.get(name);

    if (!execution) {
      throw new NotFound('Unknown Execution')
    }

    execution.deleteTime = nowTimestamp();

    if (execution.runningCount || (execution.startTime && !execution.completionTime)) {
      const container = runningContainersByExecutionName.get(name);

      if (container) {
        logger.debug({ executionName: name }, `killing running container for execution ${name}`);
        await container.kill();
        await container.remove();
        runningContainersByExecutionName.delete(name);
      }
    }
  },
  get: (name: string) => {
    const logger = getLogger(Logger.Execution);

    logger.debug({ executionName: name }, 'execution.get');

    const execution = executionsStore.get(name);

    if (!execution) {
      throw new NotFound('Unknown Execution')
    }
    
    return execution;
  },
}
