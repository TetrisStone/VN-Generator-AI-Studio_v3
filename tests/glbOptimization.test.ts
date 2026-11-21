import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { dataUrlToBlob } from '../utils/assetStore';

const createGlbIO = async (): Promise<WebIO> => {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
};

const makeSkinnedAnimatedGlb = async (io: WebIO): Promise<Uint8Array> => {
  const doc = new Document();
  const buf = doc.createBuffer();

  // Two-bone skeleton
  const jointRoot = doc.createNode('Armature_Root').setTranslation([0, 0, 0]);
  const jointChild = doc.createNode('Armature_Spine').setTranslation([0, 1, 0]);
  jointRoot.addChild(jointChild);

  const ibm = doc
    .createAccessor()
    .setType('MAT4')
    .setArray(
      new Float32Array([
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
      ])
    )
    .setBuffer(buf);

  const skin = doc
    .createSkin('CharacterSkin')
    .setSkeleton(jointRoot)
    .addJoint(jointRoot)
    .addJoint(jointChild)
    .setInverseBindMatrices(ibm);

  // Unindexed skinned mesh strip with 200 triangles (600 vertices) so weld + meshopt compress noticeably
  const triCount = 200;
  const vertCount = triCount * 3;
  const positions = new Float32Array(vertCount * 3);
  const joints = new Uint16Array(vertCount * 4);
  const weights = new Float32Array(vertCount * 4);

  for (let t = 0; t < triCount; t++) {
    const x0 = t * 0.1;
    const x1 = x0 + 0.1;
    const baseV = t * 3;
    // Triangle vertices (repeated across neighboring triangles for weld)
    positions.set([x0, 0, 0, x1, 0, 0, x0, 1, 0], baseV * 3);
    for (let k = 0; k < 3; k++) {
      const v = baseV + k;
      joints[v * 4] = k === 2 ? 1 : 0;
      weights[v * 4] = 1;
    }
  }

  const posAcc = doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buf);
  const jointAcc = doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buf);
  const weightAcc = doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buf);

  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', posAcc)
    .setAttribute('JOINTS_0', jointAcc)
    .setAttribute('WEIGHTS_0', weightAcc);
  const mesh = doc.createMesh('HeroMesh').addPrimitive(prim);
  const meshNode = doc.createNode('HeroNode').setMesh(mesh).setSkin(skin);

  doc.createScene('Scene').addChild(jointRoot).addChild(meshNode);

  // Two named animation clips with redundant linear keyframes
  const addClip = (name: string, yEnd: number) => {
    const steps = 60;
    const timeArr = new Float32Array(steps);
    const valArr = new Float32Array(steps * 3);
    for (let s = 0; s < steps; s++) {
      const f = s / (steps - 1);
      timeArr[s] = f;
      valArr[s * 3] = 0;
      valArr[s * 3 + 1] = 1 + yEnd * f;
      valArr[s * 3 + 2] = 0;
    }
    const times = doc.createAccessor().setType('SCALAR').setArray(timeArr).setBuffer(buf);
    const values = doc.createAccessor().setType('VEC3').setArray(valArr).setBuffer(buf);
    const sampler = doc
      .createAnimationSampler()
      .setInput(times)
      .setOutput(values)
      .setInterpolation('LINEAR');
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(jointChild)
      .setTargetPath('translation')
      .setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  };

  addClip('Idle', 0.2);
  addClip('Run', 0.8);

  return io.writeBinary(doc);
};

describe('GLB Optimization Pipeline (dedup, prune, resample, weld, meshopt)', () => {
  it('preserves skeleton, joints, and all animation clip names while reducing size', async () => {
    const io = await createGlbIO();
    const inputBytes = await makeSkinnedAnimatedGlb(io);
    const doc = await io.readBinary(inputBytes);

    await doc.transform(dedup(), prune(), resample(), weld());
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

    const outputBytes = await io.writeBinary(doc);
    expect(outputBytes.byteLength).toBeLessThan(inputBytes.byteLength);

    // Reload compressed GLB via MeshoptDecoder to ensure full round-trip integrity
    const reloaded = await io.readBinary(outputBytes);
    const clipNames = reloaded.getRoot().listAnimations().map((a) => a.getName());
    expect(clipNames).toEqual(['Idle', 'Run']);

    const skins = reloaded.getRoot().listSkins();
    expect(skins).toHaveLength(1);
    expect(skins[0].listJoints()).toHaveLength(2);
  });

  it('optimizes real embedded GLBs from saves/project.json (if present) by >= 50 % and keeps all animation clips', async () => {
    const projectPath = path.resolve(process.cwd(), 'saves/project.json');
    if (!fs.existsSync(projectPath)) {
      return;
    }

    const io = await createGlbIO();
    const rawJson = fs.readFileSync(projectPath, 'utf8');
    const project = JSON.parse(rawJson);
    const dungeonProjects = Array.isArray(project.dungeonProjects) ? project.dungeonProjects : [];

    const uniqueGlbs = new Map<string, { label: string; dataUrl: string }>();
    let totalOriginalBase64Chars = 0;

    const collectGlb = (label: string, dataUrl?: string) => {
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return;
      totalOriginalBase64Chars += dataUrl.length;
      if (!uniqueGlbs.has(dataUrl)) {
        uniqueGlbs.set(dataUrl, { label, dataUrl });
      }
    };

    for (const dp of dungeonProjects) {
      for (const k of ['baseFloor', 'baseWall', 'baseDoor', 'baseCharacter'] as const) {
        collectGlb(`${dp.name}:${k}`, dp?.[k]?.dataBase64);
      }
      for (const c of dp?.chunkLibrary ?? []) {
        collectGlb(`${dp.name}:chunk:${c.fileName}`, c?.dataBase64);
      }
      for (const n of dp?.npcLibrary ?? []) {
        collectGlb(`${dp.name}:npc:${n.fileName}`, n?.dataBase64);
      }
    }

    if (uniqueGlbs.size === 0) return;

    let totalRawBinaryBytes = 0;
    let totalOptimizedBinaryBytes = 0;

    for (const { label, dataUrl } of uniqueGlbs.values()) {
      const blob = dataUrlToBlob(dataUrl);
      const rawBytes = new Uint8Array(await blob.arrayBuffer());
      totalRawBinaryBytes += rawBytes.byteLength;

      const doc = await io.readBinary(rawBytes);
      const originalClips = doc.getRoot().listAnimations().map((a) => a.getName());
      const originalSkins = doc.getRoot().listSkins().map((s) => s.listJoints().length);

      await doc.transform(dedup(), prune(), resample(), weld());
      await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

      const outBytes = await io.writeBinary(doc);
      const finalBytes = outBytes.byteLength < rawBytes.byteLength ? outBytes : rawBytes;
      totalOptimizedBinaryBytes += finalBytes.byteLength;

      const reloaded = await io.readBinary(finalBytes);
      const finalClips = reloaded.getRoot().listAnimations().map((a) => a.getName());
      const finalSkins = reloaded.getRoot().listSkins().map((s) => s.listJoints().length);
      expect(finalClips, `Animation clips changed for ${label}`).toEqual(originalClips);
      expect(finalSkins, `Skin/joint count changed for ${label}`).toEqual(originalSkins);
    }

    const savingsVsEmbedded = 1 - totalOptimizedBinaryBytes / totalOriginalBase64Chars;
    console.info(
      `[GLB Benchmark saves/project.json] uniqueGLBs=${uniqueGlbs.size} | embeddedBase64=${(
        totalOriginalBase64Chars /
        (1024 * 1024)
      ).toFixed(2)} MB | rawBinary=${(totalRawBinaryBytes / (1024 * 1024)).toFixed(2)} MB | optimizedMeshopt=${(
        totalOptimizedBinaryBytes /
        (1024 * 1024)
      ).toFixed(2)} MB | savings=${(savingsVsEmbedded * 100).toFixed(1)}%`
    );

    expect(savingsVsEmbedded).toBeGreaterThanOrEqual(0.5);
  }, 60_000);
});
