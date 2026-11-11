#!/usr/bin/env python3
"""Build deterministic, sharded dm+d pack assets from an offline NHS release.

The input is the active-pack NDJSON produced by the extraction step. No TRUD
credentials or download URLs are read or emitted. VMP names are enriched from
the sibling full catalogue, if present, so brand packs match generic searches.
"""
import argparse
import base64
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
import unicodedata

COLUMNS = [
    'id', 'type', 'name', 'pack', 'quantity', 'unit', 'parentId',
    'genericId', 'genericMedicineId', 'genericName', 'brand',
    'referencePrice', 'referencePriceSource', 'releaseDate', 'manufacturer',
]
RELEASE_DATE = '2026-11-09'
EXPECTED_ARCHIVE_SHA256 = '22A32F7282B131ACD1033114368C836A8E59EF189961921A7E93FED1C61D9D7A'


def normalise(value):
    folded = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', ' ', folded).strip()


def shard_key(name):
    text = normalise(name)
    if not text or not text[0].isalpha():
        return 'xx'
    letters = re.sub(r'[^a-z]', '', text)
    return letters[:2] if len(letters) >= 2 else 'xx'


def rows(path):
    with path.open(encoding='utf-8') as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f'Invalid record at line {line_number}')
            yield value


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--medicines', type=Path, help='Optional full catalogue NDJSON for generic VMP names')
    args = parser.parse_args()
    input_path = args.input.resolve()
    output_dir = args.output.resolve()
    full_catalogue = args.medicines or input_path.with_name('catalogue.ndjson')
    metadata_path = input_path.with_name('release-metadata.json')
    metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
    archive_sha256 = str(metadata.get('archiveFileSha256', EXPECTED_ARCHIVE_SHA256)).upper()
    if archive_sha256 != EXPECTED_ARCHIVE_SHA256:
        raise ValueError('Unexpected archive checksum: inspect and deliberately update the pinned release before rebuilding.')
    release_date = metadata.get('releaseDate', RELEASE_DATE)
    if release_date != RELEASE_DATE:
        raise ValueError('Unexpected release date: update the pinned metadata deliberately before rebuilding.')

    vmp_names = {}
    if full_catalogue.exists():
        for row in rows(full_catalogue):
            if row.get('type') == 'VMP':
                vmp_names[str(row['id'])] = str(row['name'])
    # Keep a generic pack-name fallback when a medicine-only catalogue is absent.
    generic_pack_names = {}
    for row in rows(input_path):
        if row.get('type') == 'VMPP':
            generic_pack_names[str(row['id'])] = str(row['name'])

    shard_rows = defaultdict(list)
    prefix_index = defaultdict(set)
    id_index = {}
    counts = Counter()
    for row in rows(input_path):
        kind = row.get('type')
        if kind not in ('AMPP', 'VMPP'):
            raise ValueError('The input must contain active AMPP/VMPP pack records only.')
        identifier = row.get('id')
        if not isinstance(identifier, str) or not identifier.isdigit():
            raise ValueError('NHS concept identifiers must remain decimal strings.')
        identity = kind + ':' + identifier
        if identity in id_index:
            raise ValueError('Duplicate pack identity: ' + identity)
        name = str(row['name'])
        parent_id = str(row.get('parentId') or '')
        generic_id = str(row.get('genericId') or '')
        generic_medicine_id = str(row.get('genericMedicineId') or (parent_id if kind == 'VMPP' else ''))
        generic_name = str(row.get('genericName') or vmp_names.get(generic_medicine_id) or generic_pack_names.get(generic_id) or (name if kind == 'VMPP' else ''))
        brand = str(row.get('brand') or '')
        manufacturer = str(row.get('manufacturer') or '')
        key = shard_key(name)
        values = [
            identifier, kind, name, str(row.get('pack') or ''),
            row.get('quantity'), str(row.get('unit') or ''), parent_id,
            generic_id, generic_medicine_id, generic_name, brand,
            row.get('referencePrice'), str(row.get('priceSource') or ''),
            None, manufacturer,
        ]
        shard_rows[key].append(values)
        id_index[identity] = key
        counts[kind] += 1
        if generic_name:
            counts['withGenericName'] += 1
        if row.get('referencePrice') is not None:
            counts['withReferencePrice'] += 1
        search_text = normalise(' '.join([name, generic_name, brand, manufacturer]))
        for token in search_text.split():
            for prefix_length in range(2, min(4, len(token)) + 1):
                prefix_index[token[:prefix_length]].add(key)

    encoded_shards = {}
    shard_stats = {}
    for key in sorted(shard_rows):
        entries = sorted(shard_rows[key], key=lambda row: (normalise(row[2]), row[1], row[0]))
        payload = compact_json(entries)
        compressed = gzip.compress(payload, compresslevel=9, mtime=0)
        encoded_shards[key] = base64.b64encode(compressed).decode('ascii')
        shard_stats[key] = {'rows': len(entries), 'bytes': len(payload), 'gzipBytes': len(compressed)}

    counts['total'] = sum(counts[kind] for kind in ('AMPP', 'VMPP'))
    counts['shards'] = len(encoded_shards)
    counts['prefixes'] = len(prefix_index)
    dataset = {
        'releaseDate': release_date,
        'source': 'NHS dm+d',
        'columns': COLUMNS,
        'shards': encoded_shards,
        'prefixIndex': {key: sorted(value) for key, value in sorted(prefix_index.items())},
        'idIndex': dict(sorted(id_index.items())),
        'counts': dict(counts),
    }
    data_bytes = compact_json(dataset)
    dataset_sha256 = hashlib.sha256(data_bytes).hexdigest()
    release = {
        'source': 'NHS dm+d',
        'releaseDate': release_date,
        'releaseName': metadata.get('name', 'Release 11.1.0'),
        'archiveFileName': metadata.get('archiveFileName', 'nhsbsa_dmd_11.1.0_20261109000001.zip'),
        'archiveFileSha256': archive_sha256,
        'contentChecksum': dataset_sha256,
        'contentChecksumAlgorithm': 'sha256',
        'counts': dict(counts),
        'datasetBytes': len(data_bytes),
        'datasetGzipBytes': len(gzip.compress(data_bytes, compresslevel=9, mtime=0)),
        'shardGzipBytes': sum(s['gzipBytes'] for s in shard_stats.values()),
        'maximumShard': max(shard_stats.items(), key=lambda pair: pair[1]['bytes']),
        'minimumShard': min(shard_stats.items(), key=lambda pair: pair[1]['bytes']),
        'lookupPolicy': 'Only active AMPP and VMPP packs; all NHS identifiers preserved as strings.',
        'priceNotice': 'Reference dm+d list or tariff prices are not live supplier quotations.',
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename, payload in [('dmd-catalogue.json', data_bytes), ('dmd-release.json', compact_json(release) + b'\n')]:
        temporary = output_dir / (filename + '.tmp')
        temporary.write_bytes(payload)
        temporary.replace(output_dir / filename)
    print(json.dumps(release, indent=2))


if __name__ == '__main__':
    main()
