export default function createSerializedExecutor() {
  let tail = Promise.resolve();
  const execute = (task) => {
    const operation = tail.then(task, task);
    tail = operation.catch(() => null);
    return operation;
  };
  execute.drain = () => tail.catch(() => null);
  execute.reset = () => { tail = Promise.resolve(); };
  return execute;
}
