# Flower bloom rigging tools

Pure-numpy scripts that add a skeleton and a `bloom` animation (closed bud → open flower) to the
static flower GLBs in `public/assets`. No Blender required.

| Script | Purpose |
| --- | --- |
| `glb_io.py` | GLB read/write and accessor helpers shared by the rigs |
| `rig_flower_bloom.py` | Daisy: radial petal chains, texture-driven petal/disc/stem fields, bud-to-bloom clip |
| `rig_rose_bloom.py` | Glass Rose: petal chains with spiral twist, detected collar and stem leaves as sepals |

## Requirements

- Python 3.9+ with `numpy` and `Pillow`
- `@gltf-transform/cli` (already in `devDependencies`, run through `npx`)

## Workflow

The rigs expect an uncompressed float GLB, and the result is re-compressed to match the assets
already used by the game (meshopt + quantization, decoded by `FlowerModelViewer`).

```bash
# 1. decode meshopt / dequantize the source model
npx @gltf-transform/cli dequantize public/assets/flowers/yellow_jasmine_flower.glb /tmp/daisy_plain.glb

# 2. add the rig + animation
python3 tools/rigging/rig_flower_bloom.py /tmp/daisy_plain.glb /tmp/daisy_bloom_plain.glb

# 3. re-compress into the asset folder
npx @gltf-transform/cli quantize /tmp/daisy_bloom_plain.glb /tmp/daisy_bloom_q.glb
npx @gltf-transform/cli meshopt /tmp/daisy_bloom_q.glb public/assets/flowers/yellow_jasmine_flower_bloom.glb
```

Same steps for the rose with `public/assets/collectibles/glass_rose.glb` and `rig_rose_bloom.py`.
Run a script with `--help` for tuning options (sector count, clip duration, collar-leaf lean and
outward slide for the rose).

## Notes

- The bind pose is the scanned open flower; the clip starts from the generated bud pose and eases
  into the bind pose. Rose petals additionally swing ~10° past the scan so the open rose is wider.
- `createFlowerViewer` in `src/render/FlowerModelViewer.ts` does not play GLB animations yet; only
  the received-gift viewer drives an `AnimationMixer`.
