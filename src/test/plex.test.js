// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { plex } = require('../lib/plex');
const { openStore } = require('../lib/store');

test('Plex Titles carry their library, from movie and show libraries only', async () => {
  const answers = /** @type {Record<string, any>} */ ({
    '/library/sections': {
      MediaContainer: {
        Directory: [
          { key: '1', type: 'movie', title: 'Movies' },
          { key: '2', type: 'show', title: 'TV Shows' },
          { key: '3', type: 'show', title: 'Anime' },
          { key: '4', type: 'artist', title: 'Music' },
        ],
      },
    },
    '/library/sections/1/all': { MediaContainer: { Metadata: [{ ratingKey: 10, title: 'Dull Movie', year: 2020 }] } },
    '/library/sections/2/all': { MediaContainer: { Metadata: [{ ratingKey: 20, title: 'Slow Show' }] } },
    '/library/sections/3/all': {
      MediaContainer: { Metadata: [{ ratingKey: 30, title: 'Loud Anime', thumb: '/t/30' }] },
    },
  });
  const p = plex({
    url: 'http://plex:32400',
    token: 't',
    clientId: 'c',
    fetch: /** @type {typeof fetch} */ (
      async url => new Response(JSON.stringify(answers[new URL(String(url)).pathname]))
    ),
  });
  assert.deepEqual(await p.titles(), [
    { ratingKey: '10', kind: 'movie', title: 'Dull Movie', year: 2020, thumb: null, library: 'Movies' },
    { ratingKey: '20', kind: 'show', title: 'Slow Show', year: null, thumb: null, library: 'TV Shows' },
    { ratingKey: '30', kind: 'show', title: 'Loud Anime', year: null, thumb: '/t/30', library: 'Anime' },
  ]);
});

test('a database made before Titles had a library gets the column, and keeps its rows', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE titles (rating_key TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
    year INTEGER, thumb TEXT, seen INTEGER NOT NULL DEFAULT 1);
    INSERT INTO titles (rating_key, kind, title) VALUES ('1', 'movie', 'Kept')`);
  old.close();
  const store = openStore(file);
  assert.equal(store.title('1')?.title, 'Kept');
  store.replaceTitles([{ ratingKey: '1', kind: 'movie', title: 'Kept', library: 'Movies' }]);
  assert.equal(store.title('1')?.library, 'Movies');
  store.close();
});
