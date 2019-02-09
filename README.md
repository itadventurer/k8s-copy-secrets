# Copy Secrets from one Namespace to another on Kubernetes

This container/NodeJS Script copies secrets from one source namespace
to another one.

This can be used for example if secrets are managed centrally in a
namespace but the clients needing the secrets live in another one.

**Beware**: For more advanced use cases a 'real' secret management
system as [Vault](https://www.vaultproject.io/) is **highly**
recommended!

## Installation

1. Set the `NAMESPACE` environment variable where `k8s-copy-secrets`
   should watch for secrets.

### As a node script (for Development)

1. Ensure that `kubectl` is working and you can access the Kubernetes Cluster.

```sh
yarn
yarn run start
```

### As a docker container

1. Setup the `KUBECONFIG` (in dev: `$HOME/.kube/config`, in prod:
   mounted e.g. from a secret)

```sh
docker build -t k8s-copy-secrets .
docker run -e NAMESPACE=[YOUR-NAMESPACE] \
  -e KUBECONFIG=/etc/kubeconfig \
  -v [PATH-TO-YOUR-KUBECONFIG]:/etc/kubeconfig \
   k8s-copy-secrets
```

## Usage

Label the secret that should be copied with the target
namespace. Example:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: testsecret
  labels:
    k8s-copy-secret/target-namespace: foo # <---- This line is important
    # Use following label to copy additional secrets to the
    # target namespace. E.g. if you need to copy the CA cert belonging
    # to your private key
    #k8s-copy-secret/additional-secrets: testsecret2
type: Opaque
data:
  foo: YmFyCg==
  bar: YmFuYW5hCg==
```

1. On startup, `k8s-copy-secret` will attempt to copy all secrets with the
   label
   `k8s-copy-secret/target-namespace` to the target namespace.
2. When a new secret with that label is created while
   `k8s-copy-secret` is running, it will attempt to copy that secret.
3. When a secret is modified (with that label) while
   `k8s-copy-secret` is running, it will copy the secret in the target
   namespace
4. When a secret is deleted (with that label) **while
   `k8s-copy-secret` is running**, it will attempt delete the secret
   in the target namespace

**`k8s-copy-secret` will never override secrets it did not copy from the watched namespace**!
This is determined by the label
`k8s-copy-secret/source-namespace` in the target secret. If it does
not exist or does not match the watched namespace, the secret is ignored.

## Gotchas

* When a secret is deleted while no `k8s-copy-secrets` instance is
  running, the secret will not be deleted in the target namespace.
* If two `k8s-copy-secrets` instances are running in parallel watching
  the same namespace one of them will throw errors because the other
  instance was faster. Be careful
* `k8s-copy-secrets` can currently monitor only one namespace
