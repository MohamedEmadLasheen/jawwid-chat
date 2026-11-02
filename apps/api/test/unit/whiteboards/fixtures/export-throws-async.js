// PD-39 (review of #305, P0): stands in for a parser that throws from an async
// callback -- as pdfkit's PNG reader does on damaged image data. Loaded only
// inside a worker by whiteboard-image.spec.ts; never imported by the API.
exports.checkAndCompose = () =>
  new Promise(() => {
    setImmediate(() => {
      throw new Error('a parser fault nothing can catch');
    });
  });
