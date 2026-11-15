'use strict';
const MANIFEST = 'flutter-app-manifest';
const TEMP = 'flutter-temp-cache';
const CACHE_NAME = 'flutter-app-cache';

const RESOURCES = {"flutter_bootstrap.js": "c571b9c6924a7e935c8d415e85f9b432",
"version.json": "4b66f0e9c57b9362b15b565a6f971b50",
"sqlite3-3.3.4.wasm": "0d26505f2d32b5f49616648fe90b9214",
"index.html": "450d69d3db69fe90d0b9c312726a7153",
"/": "450d69d3db69fe90d0b9c312726a7153",
"main.dart.js": "6ecc73b8ad357b744797b0ea6721c8c8",
"flutter.js": "24bc71911b75b5f8135c949e27a2984e",
"app_worker.js": "adaf60d705a4ebd1f2cb7a508ca61cd3",
"favicon.png": "5d59e1b512979e23c50337daeb83db1e",
"icons/Icon-192.png": "df6d8eead08acd4783faa0fe364a26ec",
"icons/Icon-maskable-192.png": "df6d8eead08acd4783faa0fe364a26ec",
"icons/Icon-maskable-512.png": "4058f24f3fe5802f3768e41c4d79741a",
"icons/Icon-512.png": "4058f24f3fe5802f3768e41c4d79741a",
"manifest.json": "6311f5aa03e3e9a3183652fa4076cd2a",
"hub_worker.js": "327fdabe6c0d3a1a41dfa716d3cc0816",
"fonts/notosansmath/v15/7Aump_cpkSecTWaHRlH2hyV5UHkD-V048PW0.woff2": "8636d33dd4535c043d67c06b3ae1763b",
"fonts/notosansmath/OFL.txt": "d1bd14c43c975290f412e7b12482d931",
"fonts/roboto/OFL.txt": "d0d30e4860cc10440e095be065c2b0e3",
"fonts/roboto/v32/KFOmCnqEu92Fr1Me4GZLCzYlKw.woff2": "e507bd45228483ae2f864d36f26bb43e",
"fonts/notocoloremoji/OFL.txt": "a938d65db173c6e5f217497011e1659c",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.10.woff2": "2ab01ddce8268aeddfc140dd8a87ecd9",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.4.woff2": "e22de6a0ed0095a20e77b7d550ba2d8a",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.6.woff2": "cb23c1a04a30dbc0b3749a5db96bb6ce",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.2.woff2": "220cf65043af4c1cec538761b4c9f64b",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.0.woff2": "caccd985742ea4511558c749e7e0e592",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.7.woff2": "c0ff6ab12f511aa8caa3c0fad95d0577",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.11.woff2": "e562a8bc021287286bff0bbf7421424f",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.5.woff2": "675ac21bf58c86ffe577f6fb8463d85c",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.1.woff2": "3c9c7a2a4ea29e0775f4abc8b017cba9",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.3.woff2": "b0bf31613b82f8827773a912b6129080",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.9.woff2": "7a512f64a5a958251c0e3cdc127582e6",
"fonts/notocoloremoji/v32/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.8.woff2": "bc141e31e82a340aab0377d0c35c6a91",
"assets/NOTICES": "afb89164a6f9887fda9947da17072bfc",
"assets/FontManifest.json": "5a6678dd9fe91be4f50208e7dc16f7a5",
"assets/AssetManifest.bin.json": "112f040780edee163ad068125d9db2ed",
"assets/packages/cupertino_icons/assets/CupertinoIcons.ttf": "33b7d9392238c04c131b6ce224e13711",
"assets/packages/flutter_inappwebview_web/assets/web/web_support.js": "509ae636cfdd93e49b5a6eaf0f06d79f",
"assets/packages/flutter_inappwebview/assets/t_rex_runner/t-rex.css": "5a8d0222407e388155d7d1395a75d5b9",
"assets/packages/flutter_inappwebview/assets/t_rex_runner/t-rex.html": "16911fcc170c8af1c5457940bd0bf055",
"assets/shaders/ink_sparkle.frag": "ecc85a2e95f5e9f53123dcaf8cb9b6ce",
"assets/shaders/stretch_effect.frag": "40d68efbbf360632f614c731219e95f0",
"assets/AssetManifest.bin": "995037dd68ed430738d6f0b3c4f9d6ac",
"assets/fonts/MaterialIcons-Regular.otf": "b5d067cd87aaf190ccac358b8a93555d",
"assets/assets/ui/static/app/css/tokens.css": "476eee7d67157634614e9dc832330f84",
"assets/assets/ui/static/app/css/app.css": "a4eb16fd490d35dbd5b9604a421078d2",
"assets/assets/ui/static/app/css/touch.css": "fb5c057e81acf1e6b156c5fe61f06b1d",
"assets/assets/ui/static/app/css/account-screens/tokens.css": "e6e39335d38aed3661edb614a38da405",
"assets/assets/ui/static/app/css/account-screens/host.css": "220715cc29a98dbe1840af7e2542210c",
"assets/assets/ui/static/app/css/account-screens/screens.css": "0810a8b94b41bca916dd7516a55a360a",
"assets/assets/ui/static/app/css/account-screens/mascot.css": "80b754af273b811b5574aabce45d1ba0",
"assets/assets/ui/static/app/css/account-screens/stage.css": "d93bb6e389b11289ec124e04cb050266",
"assets/assets/ui/static/app/css/account-screens/scene.css": "588fdd49dedaf32949e8fc97d43558e8",
"assets/assets/ui/static/app/css/account-screens/layout.css": "079a4c7344bac036bb1930072929a41f",
"assets/assets/ui/static/app/css/account-screens/luna.css": "a8b652b97b922d6a26ad78322e00157f",
"assets/assets/ui/static/app/css/account-screens/components.css": "5932e7d06bcbc741cd3aa78e00fc0f09",
"assets/assets/ui/static/app/css/account-screens/base.css": "d0816b34b3d603b708ece14664cf16cb",
"assets/assets/ui/static/app/css/account-screens/phone.css": "529e796136947b55403e0f3c5a7bcb32",
"assets/assets/ui/static/app/css/plan-share.css": "8ac4812c6f5b94355153f3971ac1ef06",
"assets/assets/ui/static/app/css/dialog.css": "8513ae869bae1ae754f43a1e541cc157",
"assets/assets/ui/static/app/css/pages/assistant.css": "4a102312bf526de0d818d78bc01d021b",
"assets/assets/ui/static/app/css/pages/pomodoro.css": "c94e65ea62a7dac5c551f7115462fc94",
"assets/assets/ui/static/app/css/pages/email.css": "0decaf6c6cf1eb7daf85e7a9e36b2816",
"assets/assets/ui/static/app/css/pages/transit.css": "f054cec958b55e31393b6e344999a9fb",
"assets/assets/ui/static/app/css/pages/settings.css": "d14fca20cd02debaf853e3b9f2daa74b",
"assets/assets/ui/static/app/css/pages/school.css": "3d62d51b84f46878c797390b918701a0",
"assets/assets/ui/static/app/css/pages/chat.css": "0b405fc101974f7ffc6714343c18220c",
"assets/assets/ui/static/app/css/pages/bookmarks.css": "dd52a94a98b1c5accb09311cdfdef1b2",
"assets/assets/ui/static/app/css/pages/calendar.css": "1213a347ade002f840ba0a71a1260dd3",
"assets/assets/ui/static/app/css/profile.css": "4220b0c675c3e5e2bf5a379a31ce422d",
"assets/assets/ui/static/app/css/setup.css": "e8b60e936e3368a6415995b595ae8393",
"assets/assets/ui/static/app/js/shell.js": "5e3e7d5c9fe957ed098908f057069dfc",
"assets/assets/ui/static/app/js/recurrence.js": "3344a2d4e87fd6c071a4d36389684ced",
"assets/assets/ui/static/app/js/profile.js": "096773d3d87afffd312a65c87c86233f",
"assets/assets/ui/static/app/js/feedback.js": "c49a8ad02b960b729186b78dca5db4db",
"assets/assets/ui/static/app/js/chat-math.js": "46b87fd4533e200065ed0f3a60a8021d",
"assets/assets/ui/static/app/js/notes.js": "2522298009450899457fb233b4397854",
"assets/assets/ui/static/app/js/reminders.js": "9d97f7d07ef97ffc585ab476cc41170b",
"assets/assets/ui/static/app/js/account-card.js": "59b0fb69f8cfac5e8283110322eda557",
"assets/assets/ui/static/app/js/core.js": "15b26f761076069aa10c76d09924a2a8",
"assets/assets/ui/static/app/js/google-sync.js": "30cb0cecfa5a1a406bbd0ed38d392d7f",
"assets/assets/ui/static/app/js/chat-format.js": "fa9c4441a7efa2b3b1171e859fe65c3f",
"assets/assets/ui/static/app/js/backup.js": "7ff53e5032f7b355ceaa2443c7b8f4db",
"assets/assets/ui/static/app/js/profile-photo.js": "dca5c04a3ba917029f5ea24e63fa8b6a",
"assets/assets/ui/static/app/js/attention.js": "57829f960cc1cbfb5d0063dfe59f1e3b",
"assets/assets/ui/static/app/js/transit-rules.js": "d0bee0afd30fc9d6c5a6689e14f4a306",
"assets/assets/ui/static/app/js/sync.js": "7e41a7087e9982461ab819faab5d65e7",
"assets/assets/ui/static/app/js/desk.js": "f5ea96b61fc4d59d3b40a265a538efdd",
"assets/assets/ui/static/app/js/plan-share.js": "b03d0cc515a86fbdfbb550fe5ef86ee6",
"assets/assets/ui/static/app/js/plan-format.js": "4250d06132a58a106ddbc348197b3dbf",
"assets/assets/ui/static/app/js/plan-refresh.js": "64b61b35b13c6827ce3c559db3676648",
"assets/assets/ui/static/app/js/profile-sheet.js": "0a76b39b40d36859eeac2c525140a1aa",
"assets/assets/ui/static/app/js/home.js": "52ca47ede63c4d3777156bde9535f5c6",
"assets/assets/ui/static/app/js/account-screens/ui/notice.js": "4f148b98be07f04d34086c25a3e025b6",
"assets/assets/ui/static/app/js/account-screens/ui/name-field.js": "1d916573fa706baebecd109c52b9c085",
"assets/assets/ui/static/app/js/account-screens/ui/code-input.js": "9567b58f58a4c6a0213453ef24454467",
"assets/assets/ui/static/app/js/account-screens/ui/fields.js": "0d1e7d21060f0a60155bd5b807cc4707",
"assets/assets/ui/static/app/js/account-screens/ui/form-kit.js": "f27e83f896f7c0cef7b49b7ea83d8cb6",
"assets/assets/ui/static/app/js/account-screens/ui/countdown.js": "35a5b18631de865a65d871eeda198045",
"assets/assets/ui/static/app/js/account-screens/ui/button.js": "bd1ebb8b68879115e1f2e9aa230091ac",
"assets/assets/ui/static/app/js/account-screens/ui/resend.js": "b5cd5b7d15140b32b0cb0fb0bf9a3752",
"assets/assets/ui/static/app/js/account-screens/icons.js": "218f885049df1d2f39df7340d3495c5d",
"assets/assets/ui/static/app/js/account-screens/flow.js": "e5c15f638d167e41fcdec2538d2e6786",
"assets/assets/ui/static/app/js/account-screens/scene.js": "d08b1b4f405b7638f9b4a25f9a7d5bcd",
"assets/assets/ui/static/app/js/account-screens/anim.js": "4c5ae858b2c78377b97c59e58efdffe8",
"assets/assets/ui/static/app/js/account-screens/mascot/mascot.js": "02e5d2fa92d7eb3a18a283c2ff008a45",
"assets/assets/ui/static/app/js/account-screens/mascot/timelines.js": "e2578c29218e0cb13fbe100aa6ae33e9",
"assets/assets/ui/static/app/js/account-screens/mascot/art.js": "1ecf94f0fa5b2dc23645caa66e064988",
"assets/assets/ui/static/app/js/account-screens/mascot/geometry.js": "1e5e5dc29cd39cc93b42575217103d58",
"assets/assets/ui/static/app/js/account-screens/screens/reset.js": "d4c72621bb1441a1e3992492dc70d2ee",
"assets/assets/ui/static/app/js/account-screens/screens/code.js": "9038d7f9beca280c9b8a7f8a666df869",
"assets/assets/ui/static/app/js/account-screens/screens/unlock.js": "d86fb9aef51ecb616e5646db36939ac9",
"assets/assets/ui/static/app/js/account-screens/screens/delete.js": "f3d85af54b3fdcfb9c6df5402ff8cbbd",
"assets/assets/ui/static/app/js/account-screens/screens/index.js": "bc6994497a2c57c6b55feb2209a91da7",
"assets/assets/ui/static/app/js/account-screens/screens/create.js": "de62b6ea465b70e961fede4ab0d8548f",
"assets/assets/ui/static/app/js/account-screens/screens/signin.js": "c9f234b8c121b7332f28291a8cb89d25",
"assets/assets/ui/static/app/js/account-screens/screens/name.js": "c94192da32ef1b5fa5de95047d4b99b0",
"assets/assets/ui/static/app/js/account-screens/screens/forgot.js": "621c51975ca14214699ba31536fa7fae",
"assets/assets/ui/static/app/js/account-screens/screens/success.js": "515bd9dff0d700613ee8ea8b69d7512c",
"assets/assets/ui/static/app/js/account-screens/screens/guest.js": "382c46801b5be522e01dbe1512b6c6f3",
"assets/assets/ui/static/app/js/account-screens/panel.js": "4238f14c9cd7e637b90284d5067661bd",
"assets/assets/ui/static/app/js/account-screens/actor.js": "5e33252a77852f2a8153bb8cbd2719c6",
"assets/assets/ui/static/app/js/account-screens/keyboard.js": "e2045e8e9d91e7213fb182a2508bd606",
"assets/assets/ui/static/app/js/account-screens/dom.js": "d9c2022c659598860b8f8cc0a6d01fe1",
"assets/assets/ui/static/app/js/account-screens/motion.js": "822ad424a6d7d3ae4888bd7c5404c557",
"assets/assets/ui/static/app/js/account-screens/sheet.js": "8e1374a1c12582f1c98bc3d0a3dccd4e",
"assets/assets/ui/static/app/js/account-screens/messages.js": "f07cb8adbbb6bc278979dbc21d3e8925",
"assets/assets/ui/static/app/js/account-screens/luna-scene.js": "0b780558228be7509f5aefd6625d73b7",
"assets/assets/ui/static/app/js/profile-sync.js": "501321adb26540cfd7c636533c3e14de",
"assets/assets/ui/static/app/js/persistence.js": "28ea6ca6e801d52b08247cd576d28ca8",
"assets/assets/ui/static/app/js/tasks.js": "d902bf86773b18d4a483c1869d943dbd",
"assets/assets/ui/static/app/js/setup-data.js": "7b37258be0cfd207237c8e96c7c574d0",
"assets/assets/ui/static/app/js/main.js": "f20af9ac4e13bfcb811aa1f72e3b62e2",
"assets/assets/ui/static/app/js/account-ui.js": "6023b046ddcbf0022933eace3effda74",
"assets/assets/ui/static/app/js/luna.js": "628ed6e4dead55da8ec0eae66a980f8b",
"assets/assets/ui/static/app/js/account.js": "beb1dc25253db1ae43b9eacadc266caf",
"assets/assets/ui/static/app/js/transit-zones.js": "33e61517edf986fa5759ee09b8c60a2b",
"assets/assets/ui/static/app/js/pomodoro-timer.js": "b028b29b32cf9e5282a298cb01ae3af8",
"assets/assets/ui/static/app/js/qrcodegen.js": "fe924788ffd877103347f6c9ddfa80c5",
"assets/assets/ui/static/app/js/setup.js": "30778fe43d30ec4303117fe465c8b7f6",
"assets/assets/ui/static/app/js/motion.js": "56a8cb44f59e297e8a806c97a4924565",
"assets/assets/ui/static/app/js/quiet.js": "82d006ddefb0264f26b38ee8a7e19eff",
"assets/assets/ui/static/app/js/sync/client.js": "6f0c4b9ecdac1003883c9e49a7db1e86",
"assets/assets/ui/static/app/js/sync/key-store.js": "211430f3219890a241fc284eeda9ed16",
"assets/assets/ui/static/app/js/sync/profile-entry.js": "326d348c6de1a1cccf956e95ef33c777",
"assets/assets/ui/static/app/js/sync/timetable-entry.js": "662e3b23a4842bf3f3e81022349c6b4a",
"assets/assets/ui/static/app/js/account/auth-client.js": "2af9491a6fd6a108a1c33c06e73de735",
"assets/assets/ui/static/app/js/account/password-check.js": "b6fb40bc4c7ce9a435bbb4583d8afa47",
"assets/assets/ui/static/app/js/api.js": "03f087b60b6f4ea4786e0393fe959e66",
"assets/assets/ui/static/app/js/pages/assistant.js": "3e8b2f9fcbfb7254023caf28f6cbfd63",
"assets/assets/ui/static/app/js/pages/school.js": "93b80ff537f47a67c05064a0fda3b383",
"assets/assets/ui/static/app/js/pages/transit.js": "524a2172a7e4594c6eaa1c89340ffa91",
"assets/assets/ui/static/app/js/pages/bookmarks.js": "88c129ebdb877f47471b2196191b6d82",
"assets/assets/ui/static/app/js/pages/chat.js": "1513d27c024a64c5e0698450b4c75138",
"assets/assets/ui/static/app/js/pages/calendar.js": "07c183222f7227bd55dbbce76b73d1f9",
"assets/assets/ui/static/app/js/pages/pomodoro.js": "7f45467eabe31c0ba6adf3826d6430e4",
"assets/assets/ui/static/app/js/pages/settings.js": "e422e46202a5d4477d8959fbba9b84f7",
"assets/assets/ui/static/app/js/pages/email.js": "2f8b7966555ba42fc48ddbde2bb3d764",
"assets/assets/ui/static/app/js/setup-flow.js": "848d07340bedc79d2cae288a835c0190",
"assets/assets/ui/static/app/js/account-screens.js": "af6f180f04560f65fa1a781081dd3284",
"assets/assets/ui/static/app/js/mailbox.js": "1e580c23dd41a0a3e0e7ee32259c88cf",
"assets/assets/ui/static/app/js/home-rules.js": "4a9a67293056986cc0e37377ae5e2acf",
"assets/assets/ui/static/app/js/profile-crop.js": "59f6772c4702452db0fef40d6347804c",
"assets/assets/ui/static/app/img/luna/geschafft.svg": "9fc59e22434c476ec932054e4e1aa48a",
"assets/assets/ui/static/app/img/luna/laedt.svg": "6f826af56cc8c1a0cbcddd0e7e3c26f4",
"assets/assets/ui/static/app/img/luna/ruhe.svg": "3836f1e47467603bd22ddbf9d9aa397b",
"assets/assets/ui/static/app/img/luna/schlaeft.svg": "3e22a73e1f9e0a5f1f1a3f70a2223700",
"assets/assets/ui/static/app/img/hora-favicon.svg": "23673ad52f9ec37234e3af0badb8bca2",
"assets/assets/ui/static/css/tour.css": "36bc8b568fd97d3680f8a39589d0c02f",
"assets/assets/ui/static/js/tour.js": "d3539f8f3ea29e9e56b4043da07a1c4d",
"assets/assets/ui/static/js/luna.js": "5f5aa3c2b336ae7e169e74ac1a07a592",
"assets/assets/ui/static/fonts/plus-jakarta-sans.woff2": "63e4239182a6aba662549d39fb518b8f",
"assets/assets/ui/static/fonts/OFL-PlusJakartaSans.txt": "028e355944f58645eb2a8d190e6b24f6",
"assets/assets/ui/pages/home.html": "2dc49853c01900a034937c343ac49f1d",
"assets/assets/ui/pages/calendar.html": "4a432f28a8a0620b1962d35f7620bb4d",
"assets/assets/ui/pages/school.html": "53cad3b528b12f486b1d9665d3f179bb",
"assets/assets/ui/pages/tasks.html": "cc87bf2a73b4196881a0af3a66ca03cf",
"assets/assets/ui/pages/email.html": "a6e11ae218e3b633e02e25a1d17b1684",
"assets/assets/ui/pages/bookmarks.html": "493e1105c45ec79cb7dc0949f1c0d483",
"assets/assets/ui/pages/vbb.html": "93b9354bfc267dff58c7c59fe291151a",
"assets/assets/ui/pages/settings.html": "33685e2667a95fcb693d141dcf07c29a",
"assets/assets/curriculum/epochen.json": "9b015574a2db9633ce0ac6b1213e5ca8",
"assets/assets/curriculum/concepts.json": "e62d35854c2839e3f52db452aae08140",
"assets/assets/curriculum/formeln.json": "322fa521171ff3696d172cd0640a4779",
"assets/assets/curriculum/topics.json": "9326b48f01b3e8666c48fbef14df9824",
"assets/assets/logo.png": "181c7a72e46e7e6574338672e154007a",
"assets/assets/fonts/PlusJakartaSans-Light.ttf": "46efd711d89c2a5af6228256f803b9da",
"assets/assets/fonts/PlusJakartaSans-Medium.ttf": "577f61afacffa97e424680ea1de5ab15",
"assets/assets/fonts/JetBrainsMono-Regular.ttf": "d09f65145228b709a10fa0a06d522d89",
"assets/assets/fonts/PlusJakartaSans-SemiBold.ttf": "433c919124c0b81b6248398e0da087b5",
"assets/assets/fonts/PlusJakartaSans-Regular.ttf": "21f111f5e0807e40935b96633041cc4e",
"assets/assets/fonts/InterVariable.ttf": "7c80433dfb0d6e565327d9beeb774bac",
"assets/assets/fonts/PlusJakartaSans-Bold.ttf": "f9eae324ed6c4f15c68744e6b509d0f9",
"assets/assets/fonts/PlusJakartaSans-ExtraBold.ttf": "42fb5e60482acd3b9eb3cefcf8285f7b",
"assets/assets/fonts/JetBrainsMono-Medium.ttf": "b41d61d1b5a063fdcb6a7cdeacac57b0",
"assets/assets/nav_selection.json": "3b006d30b3d9d0e6d70f402e209b3d71",
"canvaskit/skwasm.js": "8060d46e9a4901ca9991edd3a26be4f0",
"canvaskit/skwasm_heavy.js": "740d43a6b8240ef9e23eed8c48840da4",
"canvaskit/skwasm.js.symbols": "3a4aadf4e8141f284bd524976b1d6bdc",
"canvaskit/canvaskit.js.symbols": "a3c9f77715b642d0437d9c275caba91e",
"canvaskit/skwasm_heavy.js.symbols": "0755b4fb399918388d71b59ad390b055",
"canvaskit/skwasm.wasm": "7e5f3afdd3b0747a1fd4517cea239898",
"canvaskit/chromium/canvaskit.js.symbols": "e2d09f0e434bc118bf67dae526737d07",
"canvaskit/chromium/canvaskit.js": "a80c765aaa8af8645c9fb1aae53f9abf",
"canvaskit/chromium/canvaskit.wasm": "a726e3f75a84fcdf495a15817c63a35d",
"canvaskit/canvaskit.js": "8331fe38e66b3a898c4f37648aaf7ee2",
"canvaskit/canvaskit.wasm": "9b6a7830bf26959b200594729d73538e",
"canvaskit/skwasm_heavy.wasm": "b0be7910760d205ea4e011458df6ee01"};
// The application shell files that are downloaded before a service worker can
// start.
const CORE = ["main.dart.js",
"index.html",
"flutter_bootstrap.js",
"assets/AssetManifest.bin.json",
"assets/FontManifest.json"];

// During install, the TEMP cache is populated with the application shell files.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  return event.waitUntil(
    caches.open(TEMP).then((cache) => {
      return cache.addAll(
        CORE.map((value) => new Request(value, {'cache': 'reload'})));
    })
  );
});
// During activate, the cache is populated with the temp files downloaded in
// install. If this service worker is upgrading from one with a saved
// MANIFEST, then use this to retain unchanged resource files.
self.addEventListener("activate", function(event) {
  return event.waitUntil(async function() {
    try {
      var contentCache = await caches.open(CACHE_NAME);
      var tempCache = await caches.open(TEMP);
      var manifestCache = await caches.open(MANIFEST);
      var manifest = await manifestCache.match('manifest');
      // When there is no prior manifest, clear the entire cache.
      if (!manifest) {
        await caches.delete(CACHE_NAME);
        contentCache = await caches.open(CACHE_NAME);
        for (var request of await tempCache.keys()) {
          var response = await tempCache.match(request);
          await contentCache.put(request, response);
        }
        await caches.delete(TEMP);
        // Save the manifest to make future upgrades efficient.
        await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
        // Claim client to enable caching on first launch
        self.clients.claim();
        return;
      }
      var oldManifest = await manifest.json();
      var origin = self.location.origin;
      for (var request of await contentCache.keys()) {
        var key = request.url.substring(origin.length + 1);
        if (key == "") {
          key = "/";
        }
        // If a resource from the old manifest is not in the new cache, or if
        // the MD5 sum has changed, delete it. Otherwise the resource is left
        // in the cache and can be reused by the new service worker.
        if (!RESOURCES[key] || RESOURCES[key] != oldManifest[key]) {
          await contentCache.delete(request);
        }
      }
      // Populate the cache with the app shell TEMP files, potentially overwriting
      // cache files preserved above.
      for (var request of await tempCache.keys()) {
        var response = await tempCache.match(request);
        await contentCache.put(request, response);
      }
      await caches.delete(TEMP);
      // Save the manifest to make future upgrades efficient.
      await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
      // Claim client to enable caching on first launch
      self.clients.claim();
      return;
    } catch (err) {
      // On an unhandled exception the state of the cache cannot be guaranteed.
      console.error('Failed to upgrade service worker: ' + err);
      await caches.delete(CACHE_NAME);
      await caches.delete(TEMP);
      await caches.delete(MANIFEST);
    }
  }());
});
// The fetch handler redirects requests for RESOURCE files to the service
// worker cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  var origin = self.location.origin;
  var key = event.request.url.substring(origin.length + 1);
  // Redirect URLs to the index.html
  if (key.indexOf('?v=') != -1) {
    key = key.split('?v=')[0];
  }
  if (event.request.url == origin || event.request.url.startsWith(origin + '/#') || key == '') {
    key = '/';
  }
  // If the URL is not the RESOURCE list then return to signal that the
  // browser should take over.
  if (!RESOURCES[key]) {
    return;
  }
  // If the URL is the index.html, perform an online-first request.
  if (key == '/') {
    return onlineFirst(event);
  }
  event.respondWith(caches.open(CACHE_NAME)
    .then((cache) =>  {
      return cache.match(event.request).then((response) => {
        // Either respond with the cached resource, or perform a fetch and
        // lazily populate the cache only if the resource was successfully fetched.
        return response || fetch(event.request).then((response) => {
          if (response && Boolean(response.ok)) {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    })
  );
});
self.addEventListener('message', (event) => {
  // SkipWaiting can be used to immediately activate a waiting service worker.
  // This will also require a page refresh triggered by the main worker.
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (event.data === 'downloadOffline') {
    downloadOffline();
    return;
  }
});
// Download offline will check the RESOURCES for all files not in the cache
// and populate them.
async function downloadOffline() {
  var resources = [];
  var contentCache = await caches.open(CACHE_NAME);
  var currentContent = {};
  for (var request of await contentCache.keys()) {
    var key = request.url.substring(origin.length + 1);
    if (key == "") {
      key = "/";
    }
    currentContent[key] = true;
  }
  for (var resourceKey of Object.keys(RESOURCES)) {
    if (!currentContent[resourceKey]) {
      resources.push(resourceKey);
    }
  }
  return contentCache.addAll(resources);
}
// Attempt to download the resource online before falling back to
// the offline cache.
function onlineFirst(event) {
  return event.respondWith(
    fetch(event.request).then((response) => {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(event.request, response.clone());
        return response;
      });
    }).catch((error) => {
      return caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response != null) {
            return response;
          }
          throw error;
        });
      });
    })
  );
}
