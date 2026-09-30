/**
 * The learner's menu over HTTP (ADR-0021).
 *
 * The rules themselves are pinned in `tests/unit/menu.test.ts`. What is pinned here is that the
 * route applies them on both sides — a stale stored menu is repaired on read, a client's proposal
 * is repaired on write — that one learner's menu is invisible to another, and that it travels in
 * the archive.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

const SECOND_PACK = { ...TEST_PACK, packId: 'second-pack', title: { en: 'Second pack' } };

describeIfMongo('the learner menu', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  const menu = async (token = 'learner-token') =>
    harness.app.inject({ method: 'GET', url: '/api/v1/me/menu', headers: auth(token) });

  const putMenu = async (payload: Record<string, unknown>, token = 'learner-token') =>
    harness.app.inject({ method: 'PUT', url: '/api/v1/me/menu', headers: auth(token), payload });

  const start = async (packId: string, token = 'learner-token') =>
    harness.app.inject({ method: 'GET', url: `/api/v1/packs/${packId}`, headers: auth(token) });

  const addSkill = async (payload: Record<string, unknown>, token = 'learner-token') =>
    harness.app.inject({ method: 'POST', url: '/api/v1/me/menu/skills', headers: auth(token), payload });

  beforeEach(async () => {
    await harness.reset();
    for (const pack of [TEST_PACK, SECOND_PACK]) {
      await harness.app.inject({ method: 'POST', url: '/coach/v1/packs', headers: auth('coach-token'), payload: pack });
    }
  });

  it('lists every started skill, loose and shown, before anything has been arranged', async () => {
    await start('test-pack');
    await start('second-pack');

    const response = await menu();

    expect(response.statusCode).toBe(200);
    expect(response.json().menu.folders).toEqual([]);
    expect(response.json().menu.placements).toEqual(
      expect.arrayContaining([
        { packId: 'test-pack', folderId: null, hidden: false },
        { packId: 'second-pack', folderId: null, hidden: false },
      ]),
    );
  });

  it('keeps a folder, what is in it, and what is hidden', async () => {
    await start('test-pack');
    await start('second-pack');

    const saved = await putMenu({
      folders: [{ folderId: 'nl', name: 'Nederlands' }],
      placements: [
        { packId: 'second-pack', folderId: 'nl', hidden: false },
        { packId: 'test-pack', folderId: null, hidden: true },
      ],
    });

    expect(saved.statusCode).toBe(200);
    expect((await menu()).json().menu).toEqual({
      folders: [{ folderId: 'nl', name: 'Nederlands' }],
      placements: [
        { packId: 'second-pack', folderId: 'nl', hidden: false },
        { packId: 'test-pack', folderId: null, hidden: true },
      ],
    });
  });

  it('adds a skill started after the menu was saved, without a write', async () => {
    await start('test-pack');
    await putMenu({ folders: [], placements: [{ packId: 'test-pack', folderId: null, hidden: true }] });

    await start('second-pack');

    expect((await menu()).json().menu.placements).toEqual([
      { packId: 'test-pack', folderId: null, hidden: true },
      { packId: 'second-pack', folderId: null, hidden: false },
    ]);
  });

  it('cannot place a skill the learner has not started', async () => {
    await start('test-pack');

    const saved = await putMenu({
      folders: [],
      placements: [
        { packId: 'second-pack', folderId: null, hidden: false },
        { packId: 'test-pack', folderId: null, hidden: false },
      ],
    });

    expect(saved.json().menu.placements).toEqual([{ packId: 'test-pack', folderId: null, hidden: false }]);
  });

  it('refuses a folder id that is not slug-shaped', async () => {
    const saved = await putMenu({ folders: [{ folderId: 'has spaces', name: 'x' }], placements: [] });
    expect(saved.statusCode).toBe(400);
  });

  // --- adding a skill from the library (ADR-0024) ---------------------------

  it('adds a skill the learner has never opened, shown and outside any folder', async () => {
    const added = await addSkill({ packId: 'second-pack' });

    expect(added.statusCode).toBe(200);
    expect(added.json().menu.placements).toEqual([{ packId: 'second-pack', folderId: null, hidden: false }]);

    const overview = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/progress',
      headers: auth('learner-token'),
    });
    expect(overview.json().packs.map((entry: { pack: { packId: string } }) => entry.pack.packId)).toEqual([
      'second-pack',
    ]);
  });

  it('files the added skill straight into the folder it was added from', async () => {
    await start('test-pack');
    await putMenu({ folders: [{ folderId: 'aws', name: 'AWS' }], placements: [] });

    const added = await addSkill({ packId: 'second-pack', folderId: 'aws' });

    expect(added.json().menu).toEqual({
      folders: [{ folderId: 'aws', name: 'AWS' }],
      placements: [
        { packId: 'test-pack', folderId: null, hidden: false },
        { packId: 'second-pack', folderId: 'aws', hidden: false },
      ],
    });
  });

  it('adds it loose when the folder named does not exist, rather than refusing', async () => {
    const added = await addSkill({ packId: 'second-pack', folderId: 'gone' });

    expect(added.statusCode).toBe(200);
    expect(added.json().menu.placements).toEqual([{ packId: 'second-pack', folderId: null, hidden: false }]);
  });

  it('shows a skill already started but hidden, keeping where it was filed', async () => {
    await start('second-pack');
    await putMenu({
      folders: [{ folderId: 'aws', name: 'AWS' }],
      placements: [{ packId: 'second-pack', folderId: 'aws', hidden: true }],
    });

    const added = await addSkill({ packId: 'second-pack' });

    expect(added.json().menu.placements).toEqual([{ packId: 'second-pack', folderId: 'aws', hidden: false }]);
  });

  it('is a 404 for a skill that is not published', async () => {
    expect((await addSkill({ packId: 'no-such-skill' })).statusCode).toBe(404);
  });

  it('adds to the calling learner only', async () => {
    await addSkill({ packId: 'second-pack' });

    expect((await menu('other-token')).json().menu.placements).toEqual([]);
  });

  it('is private to the learner', async () => {
    await start('test-pack');
    await putMenu({ folders: [{ folderId: 'nl', name: 'Nederlands' }], placements: [] });

    const other = await menu('other-token');

    expect(other.statusCode).toBe(200);
    expect(other.json().menu).toEqual({ folders: [], placements: [] });
  });

  it('is not the coach’s to read', async () => {
    expect((await menu('coach-token')).statusCode).toBe(403);
  });

  it('travels in the archive', async () => {
    await start('test-pack');
    await putMenu({
      folders: [{ folderId: 'nl', name: 'Nederlands' }],
      placements: [{ packId: 'test-pack', folderId: 'nl', hidden: false }],
    });

    const exported = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/archive',
      headers: auth('learner-token'),
    });
    const archive = exported.json();
    expect(archive.learner.menu.folders).toEqual([{ folderId: 'nl', name: 'Nederlands' }]);

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/archive/import',
      headers: auth('other-token'),
      payload: archive,
    });
    expect(imported.statusCode).toBe(200);
    expect((await menu('other-token')).json().menu).toEqual({
      folders: [{ folderId: 'nl', name: 'Nederlands' }],
      placements: [{ packId: 'test-pack', folderId: 'nl', hidden: false }],
    });
  });
});
