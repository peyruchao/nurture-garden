#!/usr/bin/env python3
"""Minimal GLB 2.0 read/write helpers shared by the flower rigging tools.

Extracted from the neocean `retarget_manta_skin.py` utilities: parse a GLB
into its JSON document + binary chunk, read accessors as numpy arrays, append
new buffer views / accessors, and write the result back out.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
COMPONENT_DTYPES = {
    5120: np.dtype("<i1"),
    5121: np.dtype("<u1"),
    5122: np.dtype("<i2"),
    5123: np.dtype("<u2"),
    5125: np.dtype("<u4"),
    5126: np.dtype("<f4"),
}
TYPE_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}



def read_glb(path: Path):
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2 or total != len(raw):
        raise ValueError(f"Invalid GLB 2.0 file: {path}")
    offset = 12
    document = None
    binary = None
    while offset < len(raw):
        length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        payload = raw[offset:offset + length]
        offset += length
        if chunk_type == JSON_CHUNK:
            document = json.loads(payload.rstrip(b" \t\r\n\0").decode("utf-8"))
        elif chunk_type == BIN_CHUNK:
            binary = bytearray(payload)
    if document is None or binary is None:
        raise ValueError(f"Missing JSON or BIN chunk: {path}")
    return document, binary


def accessor_array(document, binary, accessor_index, writable=False):
    accessor = document["accessors"][accessor_index]
    if "sparse" in accessor:
        raise ValueError("Sparse accessors are not supported by this transfer tool")
    view = document["bufferViews"][accessor["bufferView"]]
    dtype = COMPONENT_DTYPES[accessor["componentType"]]
    components = TYPE_COMPONENTS[accessor["type"]]
    item_bytes = dtype.itemsize * components
    stride = view.get("byteStride", item_bytes)
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    buffer = binary if writable else bytes(binary)
    array = np.ndarray(
        (accessor["count"], components),
        dtype=dtype,
        buffer=buffer,
        offset=offset,
        strides=(stride, dtype.itemsize),
    )
    return array




def mesh_node_index(document):
    for index, node in enumerate(document.get("nodes", [])):
        if "mesh" in node:
            return index
    raise ValueError("No mesh node found")




def first_primitive(document):
    node = document["nodes"][mesh_node_index(document)]
    return document["meshes"][node["mesh"]]["primitives"][0]




def pad4(binary: bytearray):
    while len(binary) % 4:
        binary.append(0)


def append_buffer_view(document, binary, payload, *, target=None, byte_stride=None):
    pad4(binary)
    offset = len(binary)
    binary.extend(payload)
    view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
    if target is not None:
        view["target"] = target
    if byte_stride is not None:
        view["byteStride"] = byte_stride
    document.setdefault("bufferViews", []).append(view)
    return len(document["bufferViews"]) - 1


def append_accessor(document, view_index, *, component_type, count, accessor_type, minimum=None, maximum=None):
    accessor = {
        "bufferView": view_index,
        "componentType": component_type,
        "count": int(count),
        "type": accessor_type,
    }
    if minimum is not None:
        accessor["min"] = [float(value) for value in minimum]
    if maximum is not None:
        accessor["max"] = [float(value) for value in maximum]
    document.setdefault("accessors", []).append(accessor)
    return len(document["accessors"]) - 1




def write_glb(path, document, binary):
    pad4(binary)
    document["buffers"] = [{"byteLength": len(binary)}]
    json_bytes = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    output.extend(struct.pack("<II", len(json_bytes), JSON_CHUNK))
    output.extend(json_bytes)
    output.extend(struct.pack("<II", len(binary), BIN_CHUNK))
    output.extend(binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(output)


