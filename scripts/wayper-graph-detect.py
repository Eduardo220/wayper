"""Read-only adapter to the installed detector; temporary word-count cache only."""
import hashlib
import json
import sys
import tempfile
from pathlib import Path
import graphify.detect as detector
import graphify.cli as cli
from importlib.metadata import version

root = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='wayper-graph-detect-') as temporary:
    result = detector.detect(root, follow_symlinks=False, google_workspace=False, cache_root=Path(temporary))
if result.get('walk_errors'):
    raise RuntimeError('GRAPH_CORPUS_WALK_ERROR')
files = sorted(str(Path(p).relative_to(root)) for p in result['files']['code'])
# Include every effective ignore rule, including ancestor and per-directory rules.
rules = list(detector._load_graphifyignore(root))
for parent in sorted({Path(p).parent for p in result['files']['code']}):
    while parent != root and root in parent.parents:
        rules.extend(detector._load_dir_own_ignore(parent))
        parent = parent.parent
rules = sorted(set((str(anchor), pattern) for anchor, pattern in rules))
implementation = [hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest() for module in (detector, cli)]
scope = json.dumps({'mode': 'repository-code-only', 'rules': rules, 'implementation': implementation,
                   'symlinks': False, 'workspace': False}, sort_keys=True).encode()
cli_source = Path(cli.__file__).read_text()
print(json.dumps({'files': files, 'scopeFingerprint': 'sha256:' + hashlib.sha256(scope).hexdigest(),
                  'version': 'graphify ' + version('graphifyy'),
                  'incremental': all(marker in cli_source for marker in
                                     ('merge_raw_extraction', 'resolution_context', 'clear_ast')),
                  'ignored': sorted(result.get('skipped_sensitive', []))}))
