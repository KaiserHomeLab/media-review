// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Settings → Appearance, as in Media Ops: light or dark, the accent color, a title and a logo, for every
// page, friends' included. The server writes them into each page's HTML before sending it (data-theme and
// data-accent on <html>, the title, the logo), so a page never flashes the default look first and no
// inline script is needed under the strict CSP.
//
// Accents are a fixed list, the same as Media Ops', with shades chosen for contrast in both themes
// (public/style.css). The section colors (Downvotes, Problem Reports, Leaving Soon…) never change.
'use strict';
const crypto = require('node:crypto');

const THEMES = ['auto', 'dark', 'light'];
// dark/light: the shades in public/style.css, for the swatches.
const ACCENTS = [
  { id: 'amber', label: 'Plex amber', dark: '#e5a00d', light: '#8f6200' },
  { id: 'purple', label: 'Jellyfin purple', dark: '#b98cf0', light: '#7a3fbf' },
  { id: 'green', label: 'Emby green', dark: '#5cc46a', light: '#2c7a35' },
  { id: 'blue', label: 'Blue', dark: '#6aa6f2', light: '#1f63c7' },
  { id: 'teal', label: 'Teal', dark: '#3cc4b2', light: '#00756a' },
  { id: 'red', label: 'Red', dark: '#f07a70', light: '#c0302a' },
];
const LOGO_MAX = 256 * 1024;
// Raster images only, recognised by their first bytes: an SVG can carry script.
/** @type {{ type: string, magic: (b: Buffer) => boolean }[]} */
const LOGO_TYPES = [
  { type: 'image/png', magic: b => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { type: 'image/jpeg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/webp',
    magic: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];
const KEY = 'appearance';

/** @param {any} v @param {string[]} list @param {string} def @returns {string} */
const pick = (v, list, def) => (list.includes(v) ? v : def);

/**
 * @typedef {{ theme: string, accent: string, title: string,
 *   logo: { type: string, data: string, hash: string } | null }} Appearance
 */

/** @param {import('./store').Store} store */
function appearance(store) {
  /** @returns {Appearance} */
  const read = () => {
    let a = /** @type {any} */ ({});
    try {
      a = JSON.parse(store.getSetting(KEY) ?? '{}') ?? {};
    } catch {}
    return {
      theme: pick(a.theme, THEMES, 'auto'),
      accent: pick(
        a.accent,
        ACCENTS.map(x => x.id),
        'amber',
      ),
      title: typeof a.title === 'string' ? a.title.slice(0, 40) : '',
      logo: a.logo?.data ? a.logo : null,
    };
  };
  /** @param {Appearance} a */
  const write = a => store.setSetting(KEY, JSON.stringify(a));
  return {
    read,
    // For the Settings form: the logo only as { type, hash }.
    forForm: () => {
      const a = read();
      return { ...a, logo: a.logo ? { type: a.logo.type, hash: a.logo.hash } : null, accents: ACCENTS };
    },
    // The form -> what's saved; the logo has its own upload and remove. Throws a message for the form.
    /** @param {any} input */
    save: input => {
      const title = String(input?.title ?? '').trim();
      if (title.length > 40) throw new Error('The title is too long (40 characters at most)');
      if (/[<>]/.test(title)) throw new Error("The title can't contain < or >");
      write({
        ...read(),
        theme: pick(input?.theme, THEMES, 'auto'),
        accent: pick(
          input?.accent,
          ACCENTS.map(x => x.id),
          'amber',
        ),
        title,
      });
    },
    // An uploaded logo (base64). Throws a message for the form.
    /** @param {unknown} base64 */
    setLogo: base64 => {
      const data = Buffer.from(String(base64 || ''), 'base64');
      if (!data.length) throw new Error('No image received');
      if (data.length > LOGO_MAX) throw new Error('The logo must be 256 KB or smaller');
      const kind = LOGO_TYPES.find(t => t.magic(data));
      if (!kind) throw new Error('Use a PNG, JPEG or WebP image');
      const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
      write({ ...read(), logo: { type: kind.type, data: data.toString('base64'), hash } });
      return hash;
    },
    removeLogo: () => write({ ...read(), logo: null }),
  };
}
/** @typedef {ReturnType<typeof appearance>} AppearanceSettings */

/** @type {Record<string, string>} */
const HTML_ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** @param {unknown} s */
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => HTML_ENTITY[c]);

// Put the appearance into a page's HTML: the theme and accent on <html>, the title in the tab and the
// top bar, the logo in place of the amber triangle.
/** @param {string} html @param {Appearance} a */
function renderPage(html, a) {
  const attrs = [a.theme !== 'auto' && `data-theme="${a.theme}"`, a.accent !== 'amber' && `data-accent="${a.accent}"`]
    .filter(Boolean)
    .join(' ');
  let out = html;
  if (attrs) out = out.replace('<html lang="en">', `<html lang="en" ${attrs}>`);
  if (a.title) {
    const t = escapeHtml(a.title);
    out = out.replace(/<title>Media Review/, `<title>${t}`).replace('<h1>Media Review</h1>', `<h1>${t}</h1>`);
  }
  if (a.logo)
    out = out.replaceAll(
      '<span class="logo" aria-hidden="true"></span>',
      `<img class="logo custom" src="/branding/logo?v=${a.logo.hash}" alt="">`,
    );
  return out;
}

module.exports = { appearance, renderPage, ACCENTS, THEMES, LOGO_MAX };
