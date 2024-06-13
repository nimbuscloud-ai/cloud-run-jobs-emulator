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
```

Otherwise, you can use the [Cloud Run Jobs Client Library](https://cloud.google.com/nodejs/docs/reference/run/latest/run/v2.jobsclient#_google_cloud_run_v2_JobsClient_createJob_member_1_) to set up jobs dynamically (e.g. via a script) by pointing your client to the port of the running emulator.
