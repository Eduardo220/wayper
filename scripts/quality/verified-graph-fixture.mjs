import fs from 'node:fs';
import path from 'node:path';
import { ensureGraphFresh } from '../wayper-graph.mjs';

export function writeVerifiedGraphFixture(root, repository, graph) {
  const extract = ({ output, corpus }) => {
    const directory = path.join(output, 'graphify-out'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'graph.json'), JSON.stringify(graph));
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(Object.fromEntries(corpus.files.map((file) =>
      [file.path, { ast_hash: file.md5 }]))));
  };
  const spec = { root, repository, peerDirectory: repository === 'wayper' ? 'wayper-site' : 'wayper', querySymbols: [] };
  const result = ensureGraphFresh(spec, { extract, allowDirty: true });
  if (!['FRESH', 'METADATA_DRIFT'].includes(result.status)) throw new Error(`Fixture graph failed: ${result.status}`);
  return result.metadata;
}
