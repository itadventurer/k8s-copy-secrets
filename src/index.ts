const debug = require('debug')('k8s-copy-secrets');
const k8s = require('@kubernetes/client-node');

const source_namespace = process.env.NAMESPACE;
if(!source_namespace || source_namespace === "") {
    console.error("No NAMESPACE environment variable set!");
    process.exit(1);
}

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.Core_v1Api);

let watch = new k8s.Watch(kc);
let req = watch.watch(`/api/v1/namespaces/${source_namespace}/secrets/`,
    {},
    async (type, secret) => {
        const target_namespace = secret.metadata.annotations['k8s-copy-secret/target-namespace'];
        if(target_namespace) {
            var target_secret;
            try {
                target_secret = (await k8sApi.readNamespacedSecret(secret.metadata.name, target_namespace)).body;
                const target_secret_source = target_secret.metadata.annotations['k8s-copy-secret/source-namespace'];
                if(!target_secret_source || target_secret_source != source_namespace) {
                    console.error('ERROR: Not overriding an existing secret!');
                    return;
                }
            } catch(e) {
                // do nothing as there is no conflicting secret
            }
            secret.metadata = {
                annotations: { ...secret.metadata.annotations,
                                'k8s-copy-secret/source-namespace': source_namespace
                              },
                labels: secret.metadata.labels,
                name: secret.metadata.name,
                namespace: secret.metadata.target_namespace
            };
            const debug_info = {secret_name: secret.metadata.name,
                                source_namespace, target_namespace, type};
            try {
                switch(type) {
                case 'ADDED':
                case 'MODIFIED':
                    // If a secret does not exist, create it.
                    // If a secret already exist, replace it by the new one
                    if(!target_secret) {
                        await k8sApi.createNamespacedSecret(target_namespace, secret);
                        debug('Created secret', debug_info);
                    } else {
                        await k8sApi.replaceNamespacedSecret(secret.metadata.name, target_namespace, secret);
                        debug('Patched secret', debug_info);
                    }
                    break;
                case 'DELETED':
                    if(target_secret) {
                        await k8sApi.deleteNamespacedSecret(secret.metadata.name, target_namespace, {});
                        debug('Deleted secret', debug_info);
                    } else {
                        debug('No secret found that can be deleted', debug_info);
                    }
                    break;
                default:
                    console.error(`Error: Unknown operation ${type} for secret`, secret);
                }
            } catch(e) {
                console.error("Failed Operation:", e.body, debug_info);
            }
        }
    },
    // done callback is called if the watch terminates normally
    (err) => {
        if (err) {
            console.error("ERROR:", err);
        }
    });
