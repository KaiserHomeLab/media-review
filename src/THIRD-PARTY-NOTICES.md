# Third-party notices

Media Review's own source code is MIT-licensed (see [LICENSE](../LICENSE)). It has **no npm
dependencies**: the server uses only Node.js's standard library, and the pages are plain HTML,
CSS and JavaScript.

## Included in this repository

| Component | License | Source |
|---|---|---|
| Inter typeface (`public/fonts/InterVariable.woff2`), v4.1 by Rasmus Andersson and the Inter Project Authors, the same file Media Ops ships | SIL Open Font License 1.1 (full text in `public/fonts/LICENSE-Inter.txt`) | https://github.com/rsms/inter |

## Included in the Docker image

The published image (`ghcr.io/kaiserhomelab/media-review`) is an aggregate of separately
licensed software. Each component keeps its own license; nothing here changes those terms.

| Component | License | Source |
|---|---|---|
| linuxserver.io `baseimage-alpine` (init scripts, `lsiown`, Docker Mods support) | GPL-3.0 | https://github.com/linuxserver/docker-baseimage-alpine |
| s6-overlay (process supervisor) | ISC | https://github.com/just-containers/s6-overlay |
| Alpine Linux base system and packages | various (mostly MIT, BSD, GPL-2.0) | https://pkgs.alpinelinux.org/ |
| Node.js runtime (Alpine `nodejs` package) | MIT, plus bundled dependencies' licenses | https://github.com/nodejs/node/blob/main/LICENSE |
