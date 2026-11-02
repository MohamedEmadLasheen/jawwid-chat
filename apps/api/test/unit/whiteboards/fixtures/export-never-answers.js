// PD-39 (review of #305): an export that never finishes, for the time limit. Worker-only.
exports.checkAndCompose = () => new Promise(() => setInterval(() => undefined, 1000));
