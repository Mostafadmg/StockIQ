#!/usr/bin/env python3
"""Build a compact dm+d GTIN index from the pinned offline NHS GTIN release.

Only packs present in the active dm+d catalogue are indexed. Current GTIN
associations take precedence; ended associations are retained only when a code
has no current association, so an old shelf pack can still be identified with a
clear historical warning. No TRUD credentials or download URLs are required.
"""
import argparse
import base64
from collections import Counter, defaultdict
from datetime import date
import gzip
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

XML_SHA256 = '7da0ca7cd4209d164d568758ee3334d7cc6d1e4f6a9af392b8820b62cfeab8c2'
CATALOGUE_SHA256 = '2cad688f423fc9eebb921b1a6c60c25731f04de61cf1f1eaefe461cbdf56f8f9'
RELEASE_DATE = '2026-11-09'
GTIN_RELEASE_DATE = '2026-11-05'
PREFIX_LENGTH = 5


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()


def normalize_gtin(raw):
    if not isinstance(raw, str) or len(raw) not in (8, 12, 13, 14) or not raw.isascii() or not raw.isdecimal():
        return None
    checksum = sum(int(digit) * (1 if index % 2 == 0 else 3) for index, digit in enumerate(reversed(raw)))
    return raw.zfill(14) if checksum % 10 == 0 else None


def collect_associations(elements, active_ids, release_date):
    """Pure extraction step, also used by small fixture tests."""
    release = date.fromisoformat(release_date)
    current, historical = defaultdict(dict), defaultdict(dict)
    counts = Counter()
    for element in elements:
        ampp_id = element.findtext('AMPPID') or element.findtext('APPID')
        for data in element.findall('GTINDATA'):
            counts['sourceAssociations'] += 1
            if ampp_id not in active_ids:
                counts['excludedInactivePackAssociations'] += 1
                continue
            gtin = normalize_gtin(data.findtext('GTIN'))
            if not gtin:
                counts['excludedInvalidGtinAssociations'] += 1
                continue
            start, end = data.findtext('STARTDT') or '', data.findtext('ENDDT') or ''
            try:
                start_date = date.fromisoformat(start) if start else date.min
                end_date = date.fromisoformat(end) if end else None
                if end_date and end_date < start_date:
                    raise ValueError('Association ends before it starts')
            except ValueError:
                counts['excludedInvalidDateAssociations'] += 1
                continue
            if start_date > release:
                counts['excludedFutureAssociations'] += 1
                continue
            ended = end_date is not None and end_date < release
            target = historical if ended else current
            record = [ampp_id, start or None, end or None]
            old = target[gtin].get(ampp_id)
            # One association per pack/code: prefer latest current start date or
            # most recently ended historical association for an old shelf pack.
            rank = (end or '', start) if ended else (start, end or '9999-12-31')
            old_rank = ((old[2] or '', old[1] or '') if ended else (old[1] or '', old[2] or '9999-12-31')) if old else None
            if old is None or rank > old_rank:
                target[gtin][ampp_id] = record
    index = {}
    for gtin in sorted(set(current) | set(historical)):
        is_historical = not bool(current.get(gtin))
        records = historical[gtin] if is_historical else current[gtin]
        index[gtin] = [int(is_historical), [records[key] for key in sorted(records)]]
        counts['historicalGtins' if is_historical else 'currentGtins'] += 1
        counts['historicalAssociations' if is_historical else 'currentAssociations'] += len(records)
        if len(records) > 1:
            counts['ambiguousGtins'] += 1
    counts['gtins'] = len(index)
    return index, dict(counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--catalogue', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    xml_bytes, catalogue_bytes = args.input.read_bytes(), args.catalogue.read_bytes()
    if hashlib.sha256(xml_bytes).hexdigest() != XML_SHA256:
        raise ValueError('Unexpected GTIN XML checksum; inspect and deliberately update the pinned source before rebuilding.')
    if hashlib.sha256(catalogue_bytes).hexdigest() != CATALOGUE_SHA256:
        raise ValueError('Unexpected dm+d catalogue checksum; rebuild the matching pinned release first.')
    catalogue = json.loads(catalogue_bytes)
    if catalogue.get('source') != 'NHS dm+d' or catalogue.get('releaseDate') != RELEASE_DATE:
        raise ValueError('GTIN and medicine catalogue releases must match.')
    active_ids = {key.split(':', 1)[1] for key in catalogue['idIndex'] if key.startswith('AMPP:')}
    elements = ET.fromstring(xml_bytes).findall('./AMPPS/AMPP')
    index, counts = collect_associations(elements, active_ids, RELEASE_DATE)
    shards = defaultdict(dict)
    for gtin, record in index.items():
        shards[gtin[:PREFIX_LENGTH]][gtin] = record
    encoded, shard_sizes = {}, {}
    for prefix, records in sorted(shards.items()):
        raw = compact(records)
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        encoded[prefix] = base64.b64encode(compressed).decode()
        shard_sizes[prefix] = {'gtins': len(records), 'bytes': len(raw), 'gzipBytes': len(compressed)}
    counts['shards'] = len(encoded)
    dataset = {'source': 'NHS dm+d', 'releaseDate': RELEASE_DATE, 'gtinReleaseDate': GTIN_RELEASE_DATE,
               'normalization': 'GTIN-14', 'prefixLength': PREFIX_LENGTH, 'associationColumns': ['amppId', 'startDate', 'endDate'],
               'recordLayout': '[historicalFlag, associations]', 'counts': counts, 'shards': encoded}
    dataset_bytes = compact(dataset)
    metadata = {'source': 'NHS dm+d', 'releaseDate': RELEASE_DATE, 'gtinReleaseDate': GTIN_RELEASE_DATE,
                'sourceFileName': args.input.name, 'sourceFileSha256': XML_SHA256,
                'catalogueSha256': CATALOGUE_SHA256, 'contentChecksum': hashlib.sha256(dataset_bytes).hexdigest(),
                'contentChecksumAlgorithm': 'sha256', 'counts': counts, 'datasetBytes': len(dataset_bytes),
                'datasetGzipBytes': len(gzip.compress(dataset_bytes, compresslevel=9, mtime=0)),
                'maximumShard': max(shard_sizes.items(), key=lambda item: item[1]['bytes']),
                'lookupPolicy': 'Exact validated GTIN-14; current mappings first, ended mappings only if no current mapping; active catalogue AMPP packs only; all ambiguous matches returned.',
                'priceNotice': 'GTIN identifies a medicine pack. It does not supply wholesaler availability or a live price.'}
    args.output.mkdir(parents=True, exist_ok=True)
    for name, value in [('dmd-gtin.json', dataset_bytes), ('dmd-gtin-release.json', compact(metadata) + b'\n')]:
        temporary = args.output / (name + '.tmp')
        temporary.write_bytes(value)
        temporary.replace(args.output / name)
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
