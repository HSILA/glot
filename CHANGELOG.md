# Changelog

## [0.3.1](https://github.com/HSILA/glot/compare/v0.3.0...v0.3.1) (2026-06-21)


### Bug Fixes

* **deploy:** prevent migration step from consuming streamed script stdin ([#93](https://github.com/HSILA/glot/issues/93)) ([b855303](https://github.com/HSILA/glot/commit/b8553033aeace742d801771db0f741390148a646))
* **frontend:** load custom fonts reliably ([#103](https://github.com/HSILA/glot/issues/103)) ([350c9d4](https://github.com/HSILA/glot/commit/350c9d4ad9e4d5d89814fd9866715cc7e26dbfdd)), closes [#101](https://github.com/HSILA/glot/issues/101)
* **frontend:** recenter content when sidebar collapses ([#99](https://github.com/HSILA/glot/issues/99)) ([91f4f25](https://github.com/HSILA/glot/commit/91f4f25db7321da149e8fc576b3fbf10ba91ffa8))
* **frontend:** simplify deck card due count layout ([#100](https://github.com/HSILA/glot/issues/100)) ([6fdb579](https://github.com/HSILA/glot/commit/6fdb5790a78055762b02dbc125efe17f575d2184))
* **session:** adapt keyboard hints for touch devices ([#95](https://github.com/HSILA/glot/issues/95)) ([#98](https://github.com/HSILA/glot/issues/98)) ([9cada39](https://github.com/HSILA/glot/commit/9cada399d68cd7f278749f47950670c351f81fff))

## [0.3.0](https://github.com/HSILA/glot/compare/v0.2.0...v0.3.0) (2026-06-09)


### Features

* **frontend:** requeue failed cards during study sessions ([#88](https://github.com/HSILA/glot/issues/88)) ([9b306aa](https://github.com/HSILA/glot/commit/9b306aa9d1fcf106fc430af46215acaa14bf8cec))
* randomize and stabilize review queue ordering ([#89](https://github.com/HSILA/glot/issues/89)) ([9a56c21](https://github.com/HSILA/glot/commit/9a56c215d365dd05d1dd6fe0bde751a448a8c4cf))
* **review:** show optional language-learning fields on review cards ([#90](https://github.com/HSILA/glot/issues/90)) ([8dc4896](https://github.com/HSILA/glot/commit/8dc4896a7c58cf88a529f2c2d45c28580725f26b))
* **review:** wire CardMetadata into API schemas, add Gender/WordType enums, CSS line-clamp ([#91](https://github.com/HSILA/glot/issues/91)) ([edcbb3d](https://github.com/HSILA/glot/commit/edcbb3de38cfdf4f00f6804e540580f4e2579c54))


### Bug Fixes

* **infra:** stop containers before deploy to avoid name conflicts ([#84](https://github.com/HSILA/glot/issues/84)) ([9c90089](https://github.com/HSILA/glot/commit/9c90089a606d0684793e695bf85bae37256fc141))


### Miscellaneous Chores

* **infra:** timestamp production deploy steps ([#92](https://github.com/HSILA/glot/issues/92)) ([0da38d4](https://github.com/HSILA/glot/commit/0da38d4c882a4b7947c1bd79ec9515bd14bccead))

## [0.2.0](https://github.com/HSILA/glot/compare/v0.1.0...v0.2.0) (2026-05-28)


### ⚠ BREAKING CHANGES

* **auth:** Switched password hashing to Argon2 and enforced timezone-aware database columns. Existing passwords are no longer valid, and database schema changes require a reset.

### Features

* add deck detail page with infinite-scroll cards list ([#36](https://github.com/HSILA/glot/issues/36)) ([895bd98](https://github.com/HSILA/glot/commit/895bd981f1b502c487b2305519b1a0de6fa804f7))
* add PDF upload with R2 integration and markdown extraction capabilities ([356f6c3](https://github.com/HSILA/glot/commit/356f6c34112702a28dc96f066a68bf2a957eefa7))
* add typed frontend clients for decks and cards ([#11](https://github.com/HSILA/glot/issues/11)) ([f953a08](https://github.com/HSILA/glot/commit/f953a08fb372e66e9861381ac0eae5276882ea2b))
* **auth:** overhaul authentication flow and security infrastructure ([07f948f](https://github.com/HSILA/glot/commit/07f948f6ea4e36ab0dff0fca9a103a272bd5b946))
* **backend,frontend:** require manual admin approval for new users ([#80](https://github.com/HSILA/glot/issues/80)) ([7e3bcea](https://github.com/HSILA/glot/commit/7e3bceae3c71fc17e2a21ed710992ae52620cba9)), closes [#79](https://github.com/HSILA/glot/issues/79)
* **backend:** add deck stats (new_count, due_count, last_studied_at) ([#47](https://github.com/HSILA/glot/issues/47)) ([a4a4401](https://github.com/HSILA/glot/commit/a4a4401edfe4245a8772954bb8dd1fa8ced0e858))
* **backend:** add multi-user support with User model and settings ([e17e765](https://github.com/HSILA/glot/commit/e17e765dcb5e2853d4473a51d88843d6014d8f13))
* **backend:** implement JWT authentication with multi-device support ([d8fc54c](https://github.com/HSILA/glot/commit/d8fc54c8cdeaabf9a13f297a34e1537cf6c9d418))
* **cards:** paginate + newest-first + deck sequence ([#40](https://github.com/HSILA/glot/issues/40)) ([18b0c45](https://github.com/HSILA/glot/commit/18b0c451621dc72939f4944a45a677049fe3a6fe))
* enable new deck modal with compact deck metadata ([#31](https://github.com/HSILA/glot/issues/31)) ([eea8b39](https://github.com/HSILA/glot/commit/eea8b39baac8768ca44482ced85c721540f41054))
* enforce card endpoint auth and ownership ([#9](https://github.com/HSILA/glot/issues/9)) ([3ffd4db](https://github.com/HSILA/glot/commit/3ffd4dbda0e7cde968b7e3e8ca412924a75c59a1))
* enforce deck ownership on all deck endpoints ([#2](https://github.com/HSILA/glot/issues/2)) ([a9cce2b](https://github.com/HSILA/glot/commit/a9cce2b6fa1585d81989a612bc06acfc14397463))
* expand agent mention relay to cover all PR/issue contexts ([#39](https://github.com/HSILA/glot/issues/39)) ([32d7ee6](https://github.com/HSILA/glot/commit/32d7ee647bd41d493258afda27ae753467cfd915))
* **frontend:** card actions menu (edit + delete) ([#46](https://github.com/HSILA/glot/issues/46)) ([f8d061f](https://github.com/HSILA/glot/commit/f8d061fc9e64f6de6e810a47cdef5f7b2a17f185))
* **frontend:** deck actions (edit/delete) ([#44](https://github.com/HSILA/glot/issues/44)) ([86d4faf](https://github.com/HSILA/glot/commit/86d4faf095207b376cb8d71ae83c8076a0960b8d))
* **frontend:** implement comprehensive UI redesign ([#68](https://github.com/HSILA/glot/issues/68)) ([d7022e8](https://github.com/HSILA/glot/commit/d7022e8600546acc6e11940125fb072121a8e1d8))
* **frontend:** implement Next.js PWA UI shell ([b8d67bc](https://github.com/HSILA/glot/commit/b8d67bcc9407847abb385554d119d91e91094cb2))
* improve resource detail modal and fix name handling ([7a161b4](https://github.com/HSILA/glot/commit/7a161b4899ef774c0ed41cfb9dee9c7a4a4bc026))
* **infra:** add deploy step to build pipeline ([#81](https://github.com/HSILA/glot/issues/81)) ([d842e13](https://github.com/HSILA/glot/commit/d842e13a96dd46cf5538d0683f4f67dd974abf8f))
* integrate Alembic migrations + startup flow ([#52](https://github.com/HSILA/glot/issues/52)) ([9df1166](https://github.com/HSILA/glot/commit/9df11661ba54a292c4ae61a9b23c9abac6bcee68))
* make async R2 calls non-blocking in API and workers ([#62](https://github.com/HSILA/glot/issues/62)) ([0092666](https://github.com/HSILA/glot/commit/00926665d1fea267fbd27f9a35da31095b1eabe8))
* persist deck color and tags in backend, remove hierarchy ([#34](https://github.com/HSILA/glot/issues/34)) ([41f8c3b](https://github.com/HSILA/glot/commit/41f8c3b7a0efa118879cc4b91d42e48989df590e))
* scope FSRS settings to current user ([#10](https://github.com/HSILA/glot/issues/10)) ([22023d6](https://github.com/HSILA/glot/commit/22023d60a08dd6cc1342ecd877c172d94ebc2311))


### Bug Fixes

* **backend:** bcrypt-to-argon2 migration and deploy fixes ([#82](https://github.com/HSILA/glot/issues/82)) ([acd5392](https://github.com/HSILA/glot/commit/acd53926603cc1c6b0c3fbe3bc64c98b0c7aca6f))
* **backend:** require JWT secret from environment ([#54](https://github.com/HSILA/glot/issues/54)) ([6035629](https://github.com/HSILA/glot/commit/6035629115a727f93db6e91ae575e85d18a2af50))
* **backend:** tune async DB pool settings for reliability ([#64](https://github.com/HSILA/glot/issues/64)) ([52f6a1c](https://github.com/HSILA/glot/commit/52f6a1ca04a3b2b13db661918cd9ffae202f913d))
* bind docker-compose services to localhost by default ([#5](https://github.com/HSILA/glot/issues/5)) ([5edba03](https://github.com/HSILA/glot/commit/5edba0379fc50ce58c86859bb9615f2a1e38736d))
* correct relay workflow yaml script block ([#26](https://github.com/HSILA/glot/issues/26)) ([7b1b039](https://github.com/HSILA/glot/commit/7b1b039f8e7f927c47272075bd7ddb178d78adcc))
* **frontend:** refresh auth sessions before logout ([#71](https://github.com/HSILA/glot/issues/71)) ([b103187](https://github.com/HSILA/glot/commit/b10318733ba324022586ff6ca4f15393b7d58c63))
* **frontend:** wire session rating buttons ([#75](https://github.com/HSILA/glot/issues/75)) ([b3713d1](https://github.com/HSILA/glot/commit/b3713d18410608e047883a1f44a675f52961e477))
* **github:** ensure mention relay requests markdown replies ([#38](https://github.com/HSILA/glot/issues/38)) ([ab27d86](https://github.com/HSILA/glot/commit/ab27d863f746d1cc7f467c0a9e00ad161b0c5a5f))
* resilient extraction recovery after worker interruption ([#8](https://github.com/HSILA/glot/issues/8)) ([a607220](https://github.com/HSILA/glot/commit/a607220ff3352f931f3dfb202f99dfd03df0dd3e))
* restore pointer cursor behavior in frontend UI controls ([#66](https://github.com/HSILA/glot/issues/66)) ([9e411ae](https://github.com/HSILA/glot/commit/9e411ae9aee5f751b941a9e99adce3b7b5812d5b))
* use content-hash filename for raw downloads ([#57](https://github.com/HSILA/glot/issues/57)) ([22a7c65](https://github.com/HSILA/glot/commit/22a7c65583cbefa09f6331722cf50e79a788f554))
* validate only branch commits in pre-push hook ([#7](https://github.com/HSILA/glot/issues/7)) ([cd4436d](https://github.com/HSILA/glot/commit/cd4436db3ca07beba84d2dc1b4299c0198caf03c))


### Code Refactoring

* **pdf-viewer:** rewrite with continuous scroll, lazy loading, and performance fixes ([36645e8](https://github.com/HSILA/glot/commit/36645e8e6adbcc94b31e726df791e1971be94acf))
* **redis:** improve connection handling and optimize for Upstash ([a7cb2eb](https://github.com/HSILA/glot/commit/a7cb2eb6489357b85ccf58f67cb5399f2d023256))
* reuse worker services and extraction agent ([#63](https://github.com/HSILA/glot/issues/63)) ([0dc4616](https://github.com/HSILA/glot/commit/0dc461621214aad26bedad46c26609dd4d4d6c59))


### Tests

* **frontend:** add balanced critical-path coverage ([#73](https://github.com/HSILA/glot/issues/73)) ([fd0e97a](https://github.com/HSILA/glot/commit/fd0e97a70430f01355c5bb2b5213c718d579ccd7)), closes [#72](https://github.com/HSILA/glot/issues/72)


### Miscellaneous Chores

* add Docker infrastructure and justfile for development ([#3](https://github.com/HSILA/glot/issues/3)) ([f45b488](https://github.com/HSILA/glot/commit/f45b48881143f51d8aa1b218b60890da6860123e))
* add hardened agent mention relay workflow ([#25](https://github.com/HSILA/glot/issues/25)) ([b895055](https://github.com/HSILA/glot/commit/b895055440e20b20a1d0247988d6c7e92ebd9aeb))
* add production docker-compose for GHCR pipeline ([#78](https://github.com/HSILA/glot/issues/78)) ([0909c95](https://github.com/HSILA/glot/commit/0909c959483b9de416919ca9432f07f31d240b59))
* enforce conventional commit message policy ([#1](https://github.com/HSILA/glot/issues/1)) ([0a5dc9a](https://github.com/HSILA/glot/commit/0a5dc9aea09f081b4a2ab3e0ddf4a2d5da63451a))
* introduce release-please automation ([#76](https://github.com/HSILA/glot/issues/76)) ([7dee391](https://github.com/HSILA/glot/commit/7dee39196fa8bbeffdc45ad926ee464055a1d1ff))
* reduce worker and library polling ([#50](https://github.com/HSILA/glot/issues/50)) ([344e357](https://github.com/HSILA/glot/commit/344e357698bfb7ae3cee3440fbaee7bf4f711854))
* remove unused nueauth-minimal mock app ([e64ae46](https://github.com/HSILA/glot/commit/e64ae460bf629e96a3be3c8e35c21a108236b0e8))
