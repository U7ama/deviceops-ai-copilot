"""Export/check the Python service boundary schemas; does not access AWS."""
import json
from pathlib import Path
import sys
from models import EmbeddingRequest, EmbeddingResult, InvestigationRequest, InvestigationResult


def main() -> int:
    check = sys.argv[1:] == ['--check']
    root = Path(__file__).with_name('schemas')
    if not check:
        root.mkdir(exist_ok=True)
    stale = []
    for schema in [InvestigationRequest, InvestigationResult, EmbeddingRequest, EmbeddingResult]:
        path = root / f'{schema.__name__}.json'
        content = json.dumps(schema.model_json_schema(), indent=2, sort_keys=True) + '\n'
        if check:
            if not path.exists() or path.read_text() != content:
                stale.append(path.name)
        else:
            path.write_text(content)
    if stale:
        print('Stale schemas: ' + ', '.join(stale))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
