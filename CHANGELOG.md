# [2.3.0](https://github.com/deggesim/sim-driving-coach/compare/v2.2.0...v2.3.0) (2026-11-14)


### Features

* step in click per pressioni gomme e campanatura ([#28](https://github.com/deggesim/sim-driving-coach/issues/28)) ([d97d339](https://github.com/deggesim/sim-driving-coach/commit/d97d3397c800db58c0805518a690a8cc50e9237d))

# [2.2.0](https://github.com/deggesim/sim-driving-coach/compare/v2.1.0...v2.2.0) (2026-11-14)


### Features

* step da 10 punti per i parametri percentuali del setup ([#27](https://github.com/deggesim/sim-driving-coach/issues/27)) ([df55c10](https://github.com/deggesim/sim-driving-coach/commit/df55c10e39fa46efef45ec2b2733ece258635400))

# [2.1.0](https://github.com/deggesim/sim-driving-coach/compare/v2.0.0...v2.1.0) (2026-11-13)


### Features

* step in punti per i parametri percentuali del setup ([#26](https://github.com/deggesim/sim-driving-coach/issues/26)) ([547d403](https://github.com/deggesim/sim-driving-coach/commit/547d403cd3f2278331f4839ec0d17ca58904dc92))

# [2.0.0](https://github.com/deggesim/sim-driving-coach/compare/v1.2.0...v2.0.0) (2026-11-13)


* feat!: interfaccia, voce e analisi in 5 lingue ([#25](https://github.com/deggesim/sim-driving-coach/issues/25)) ([6940618](https://github.com/deggesim/sim-driving-coach/commit/6940618623876d67fbb05fa8506dc1f0320a8f13))


### BREAKING CHANGES

* i setup salvati con nomi italiani non sono più riconosciuti dalla messa a punto; serve un reset del DB.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* feat: prompt in inglese con output nella lingua scelta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* fix: ban del gergo di procedura limitato alla procedura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* feat: interfaccia tradotta (impostazioni e guscio app)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* feat: interfaccia tradotta (sessioni, giri e analisi)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* fix: ripristina il fuso orario nelle date dello storico sessioni

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* feat: interfaccia tradotta (setup)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* feat: voce e riconoscimento vocale nella lingua scelta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* feat: alert e deviazioni nella lingua scelta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* feat: conferme vocali, messaggi e PDF localizzati

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* feat: comandi vocali in 5 lingue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* docs: regole i18n in CLAUDE.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* fix: falsi positivi dei comandi vocali e rifiniture i18n

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

* i18n Azure regions

# [1.2.0](https://github.com/deggesim/sim-driving-coach/compare/v1.1.0...v1.2.0) (2026-11-11)


### Features

* notifica di aggiornamento all'avvio con download e installazione ([#24](https://github.com/deggesim/sim-driving-coach/issues/24)) ([3cc9419](https://github.com/deggesim/sim-driving-coach/commit/3cc94194582b4cb9c9f6af41f0a3cc05961464d6))

# [1.1.0](https://github.com/deggesim/sim-driving-coach/compare/v1.0.0...v1.1.0) (2026-11-10)


### Bug Fixes

* **a11y:** correzioni dall'audit del renderer ([065d347](https://github.com/deggesim/sim-driving-coach/commit/065d347de602bf336bb9504997b620ed87c5f15d))
* **ams2:** riconosci l'auto dalla classe quando il nome non è in tabella ([cd2f394](https://github.com/deggesim/sim-driving-coach/commit/cd2f394423752df3bb405d81ecd38068017e1f01))
* **ci:** fissa [@emnapi](https://github.com/emnapi) nel lockfile per npm ci su Linux ([#23](https://github.com/deggesim/sim-driving-coach/issues/23)) ([3a8c598](https://github.com/deggesim/sim-driving-coach/commit/3a8c598a90038fdf8c9e8cf085ae39a08b37e459))
* **coach:** campanatura AMS2 giudicata con la regola Frezza ([ebb5ebe](https://github.com/deggesim/sim-driving-coach/commit/ebb5ebe9f799aa5a21dd6672382321c2f455f67d))
* **coach:** curve critiche senza dati di zona non diventano zero ([05e7759](https://github.com/deggesim/sim-driving-coach/commit/05e7759583ab1b517edec563e6fcc0d7b9151565))
* **coach:** scalata nervosa solo se il posteriore non slittava gia ([300732f](https://github.com/deggesim/sim-driving-coach/commit/300732fbc9eaaf98428e5a58e8d0e36bcd26f7ae))
* **r3e:** mescola del setup decodificata al contrario ([1204869](https://github.com/deggesim/sim-driving-coach/commit/1204869d2e8e79d96d77b3ebb19c3c40027b945a))
* **ui:** badge setup dei giri dello stesso colore del badge analisi ([820e204](https://github.com/deggesim/sim-driving-coach/commit/820e2044881e7511f9429ed9a4c4246b9c0447da))


### Features

* **coach:** pressioni e campanatura non giudicate su gomme fuori finestra ([9045c91](https://github.com/deggesim/sim-driving-coach/commit/9045c91bbe1f7b93713d92b56f7fb24575ec906b))
* **history:** eliminazione multipla delle sessioni con checkbox ([53e1c50](https://github.com/deggesim/sim-driving-coach/commit/53e1c5054acd4ce96394e4183bd304b8e9ea439a))
* **r3e:** log della finestra mescola e riferimenti SHM ufficiali ([56e4440](https://github.com/deggesim/sim-driving-coach/commit/56e4440223d982bee2ced297cfeb69aa96fc9739))
* **ui:** correzioni dalla critique del renderer ([a28b7a5](https://github.com/deggesim/sim-driving-coach/commit/a28b7a5068935d5c1b77247ad9c9485bb626d27b)), closes [#8c8c8c](https://github.com/deggesim/sim-driving-coach/issues/8c8c8c)
