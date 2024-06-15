# Google Cloud Run Jobs Emulator

This emulator tries to emulate the behaviour of [Cloud Run Jobs](https://cloud.google.com/run/docs/create-jobs). As of this writing, Google does not provide a [Cloud Run Jobs](https://cloud.google.com/run/docs/create-jobs) emulator, which makes local development a huge pain. This project aims to help you out until they do release an official emulator.

**This project is not associated with Google.**

Credit to [@kurtschwarz](https://github.com/kurtschwarz) for [the original implementation](https://github.com/kurtschwarz/cloud-run-jobs-emulator), which this is based on.

## Usage

### Docker Compose

To use this emulator with `docker compose` you'll need to add it as a service. To specify images in advance as job definitions, create a `cloud-run-jobs-config.yaml` file.

```yaml
services:
  cloud-run-jobs-emulator:
    image: mattkindynimbus/cloud-run-jobs-emulator:latest
    configs:
      - source: cloud-run-jobs-config
        target: /cloud-run-jobs-config.yaml
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock

configs:
  cloud-run-jobs-config:
    file: ./cloud-run-jobs-config.yaml
```

The `cloud-run-jobs-config.yaml` file should have the following structure:

```yaml
jobs:
  some-awesome-job:
    image: my-docker-image:tag
  another-great-job:
    image: my-docker-image:tag
    # env is optional list of key-value pairs
    env: 
      - key: SOME_ENV_VAR
        value: some-value
```

If your container needs to use Application Default Credentials (ADC) to authenticate with Google Cloud, you can mount your `~/.config/gcloud` directory into the emulator container via the configuration file

```yaml
jobs:
  ...
applicationDefaultCredentials: $HOME/.config/gcloud
```

This directory will be mounted at `/gcp/config` in the conatiner. You can then specify the location of a service account key file to use for authentication:

```yaml
jobs:
  my-job-using-adc:
    image: my-docker-image:tag
    env:
      - key: GOOGLE_APPLICATION_CREDENTIALS
        value: /gcp/config/service-account-creds.json # e.g. if the key file is in ~/.config/gcloud/service-account-creds.json
applicationDefaultCredentials: $HOME/.config/gcloud
```

Otherwise, you can use the [Cloud Run Jobs Client Library](https://cloud.google.com/nodejs/docs/reference/run/latest/run/v2.jobsclient#_google_cloud_run_v2_JobsClient_createJob_member_1_) to set up jobs dynamically (e.g. via a script) by pointing your client to the port of the running emulator.

## :warning: Current Limitations

- State -- such as registered jobs, executions -- are stored in-memory. This means that if the service is restarted, the state will be wiped fresh. In the longer term, we'd like to support a persistent volume or at least handle this on-disk in the container, so that it will survive container restarts.
- Not all Cloud Run Job APIs are implemented, such as `Task`-related APIs. These will be added on an as-needed/as-requested basis. Please feel free to drop a PR!
- `LongRunning` operations are not yet supported, so awaiting `.promise()` on a `createJob` calls (along with other methods that return a `LongRunningOperation`) will error.
- `CreateJob` doesn't use any information from the specified template other than the image name. This will be expanded in the near future (🤞) to support the typical needs (e.g. volumes for Cloud SQL access).
