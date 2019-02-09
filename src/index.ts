const debug = require('debug')('k8s-copy-secrets');
const k8s = require('@kubernetes/client-node');

const source_namespace = process.env.NAMESPACE;
if(!source_namespace || source_namespace === "") {
    console.error("No NAMESPACE environment variable set!");
    process.exit(1);
}

const kc = new k8s.KubeConfig();
if(!process.env.KUBECONFIG || process.env.KUBECONFIG === "") {
    kc.loadFromCluster();
} else {
    kc.loadFromDefault();
}

const k8sApi = kc.makeApiClient(k8s.Core_v1Api);

async function get_secret(namespace, name) {
    try {
        return (await k8sApi.readNamespacedSecret(name, namespace)).body;
    } catch(e) {
        return null;
    }
}

async function assert_overridable_target(source_namespace, secret_name, target_namespace) {
    var target_secret = await get_secret(target_namespace, secret_name);
    if(target_secret) {
        const target_secret_source = target_secret.metadata.labels['k8s-copy-secret/source-namespace'];
        if(!target_secret_source || target_secret_source != source_namespace) {
            throw new Error('ERROR: Not overriding an existing secret!');
        }
        return true;
    }
    return true;
}

async function copy_secret(source_namespace, secret, target_namespace) {
    secret.metadata = {
        labels: { ...secret.metadata.labels,
                       'k8s-copy-secret/source-namespace': source_namespace
                },
        annotations: secret.metadata.annotations,
        name: secret.metadata.name,
        namespace: secret.metadata.target_namespace
    };
    const debug_info = {secret_name: secret.metadata.name,
                        source_namespace, target_namespace};
    if(await get_secret(target_namespace, secret.metadata.name)) {
                        await k8sApi.replaceNamespacedSecret(secret.metadata.name, target_namespace, secret);
        debug('Patched secret', debug_info);
    } else {
        await k8sApi.createNamespacedSecret(target_namespace, secret);
        debug('Created secret', debug_info);
    }
}

async function delete_secret(namespace, secret_name) {
    const debug_info = {secret_name, namespace};
    if(await get_secret(namespace, secret_name)) {
        await k8sApi.deleteNamespacedSecret(secret_name, namespace, {});
        debug('Deleted secret', debug_info);
    } else {
        debug('No secret found that can be deleted', debug_info);
    }
}

let watch = new k8s.Watch(kc);
let req = watch.watch(
    `/api/v1/namespaces/${source_namespace}/secrets/`,
    {},
    async (type, secret) => {
        if(!secret.metadata || !secret.metadata.labels) {
            return;
        }
        debug("Detected secret: ", secret.metadata.name);
        const target_namespace = secret.metadata.labels['k8s-copy-secret/target-namespace'];
        if(target_namespace) {
            debug("Target namespace: ", target_namespace)
            try {
                // Collect secrets to copy
                const secrets_to_copy:any[] =[secret];
                const additional_secrets_str = secret.metadata.labels['k8s-copy-secret/additional-secrets'];
                if(additional_secrets_str) {
                    for(const secret_name of additional_secrets_str.split(",")) {
                        const secret = await get_secret(source_namespace, secret_name.trim());
                        if(secret) {
                            secrets_to_copy.push(secret);
                        } else {
                            // if a secret that is to be deleted does
                            // not exist that is ok
                            if(type==='DELETED') {
                                secrets_to_copy.push({metadata: {name: secret_name}});
                            } else {
                                throw new Error('ERROR: No such secret:' + secret_name);
                            }
                        }
                    }
                }
                // Assert if we are allowed to touch the target secrets
                for(const secret of secrets_to_copy) {
                    assert_overridable_target(source_namespace, secret.metadata.name, target_namespace);
                }

                // Decide what to do
                switch(type) {
                case 'ADDED':
                case 'MODIFIED':
                    for(const secret of secrets_to_copy) {
                        copy_secret(source_namespace, secret, target_namespace);
                    }
                    break;
                case 'DELETED':
                    for(const secret of secrets_to_copy) {
                        delete_secret(target_namespace, secret.metadata.name);
                    }
                    break;
                default:
                    console.error(`Error: Unknown operation ${type} for secret`, secret);
                }
            } catch(e) {
                console.error("Failed Operation:", e.body, {
                    secret_name: secret.metadata.name,
                    source_namespace, target_namespace});
            }
        } else {
            debug("No target namespace detected");
        }
    },
    // done callback is called if the watch terminates normally
    (err) => {
        if (err) {
            console.error("ERROR:", err);
        }
    });
debug("watching…");
