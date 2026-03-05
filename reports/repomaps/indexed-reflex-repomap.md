# Repo Map: reflex


# generated repo map
```
└── reflex
    ├── docs
    │   ├── docs
    │   │   ├── advanced-guides
    │   │   │   ├── index.md
    │   │   │   ├── middleware.md
    │   │   │   └── server-client-sync.md
    │   │   ├── guides
    │   │   │   ├── roact-reflex
    │   │   │   │   ├── index.md
    │   │   │   │   ├── selecting-state.md
    │   │   │   │   └── using-the-producer.md
    │   │   │   ├── index.md
    │   │   │   ├── observers-and-entities.md
    │   │   │   ├── organizing-producers.md
    │   │   │   ├── subscribing-to-state.md
    │   │   │   ├── using-selectors.md
    │   │   │   └── your-first-producer.md
    │   │   ├── quick-start
    │   │   │   ├── examples.md
    │   │   │   ├── index.md
    │   │   │   └── installation.md
    │   │   └── reference
    │   │       ├── reflex
    │   │       │   ├── combine-producers.md
    │   │       │   ├── create-broadcast-receiver.md
    │   │       │   ├── create-broadcaster.md
    │   │       │   ├── create-producer.md
    │   │       │   ├── create-selector.md
    │   │       │   ├── index.md
    │   │       │   ├── middleware.md
    │   │       │   └── producer.md
    │   │       └── roact-reflex
    │   │           ├── index.md
    │   │           ├── reflex-provider.md
    │   │           ├── use-producer.md
    │   │           ├── use-selector-creator.md
    │   │           └── use-selector.md
    │   ├── src
    │   │   ├── components
    │   │   │   └── HomepageFeatures
    │   │   │       ├── index.js
    │   │   │       └── styles.module.css
    │   │   ├── css
    │   │   │   └── custom.css
    │   │   └── pages
    │   │       ├── index.js
    │   │       └── index.module.css
    │   ├── static
    │   │   └── img
    │   │       ├── favicon.ico
    │   │       ├── hero_folder_dark.svg
    │   │       ├── hero_folder_light.svg
    │   │       ├── hero_package_dark.svg
    │   │       ├── hero_package_light.svg
    │   │       ├── hero_plug_dark.svg
    │   │       ├── hero_plug_light.svg
    │   │       ├── logo-white.svg
    │   │       ├── logo.png
    │   │       ├── logo.svg
    │   │       ├── social_card.png
    │   │       └── splash.png
    │   ├── themes
    │   │   ├── dark.js
    │   │   └── light.js
    │   ├── README.md
    │   ├── babel.config.js
    │   ├── docusaurus.config.js
    │   ├── package.json
    │   ├── pnpm-lock.yaml
    │   └── sidebars.js
    ├── public
    │   └── logo.png
    ├── scripts
    │   ├── analyze.sh
    │   └── testez.d.lua
    ├── src
    │   ├── broadcast
    │   │   ├── createBroadcastReceiver.lua
    │   │   ├── createBroadcastReceiver.spec.lua
    │   │   ├── createBroadcaster.lua
    │   │   ├── createBroadcaster.spec.lua
    │   │   ├── hydrate.lua
    │   │   └── init.lua
    │   ├── middleware
    │   │   └── loggerMiddleware.lua
    │   ├── utils
    │   │   ├── createSelectArrayDiffs.lua
    │   │   ├── createSelectArrayDiffs.spec.lua
    │   │   ├── setInterval.lua
    │   │   ├── shallowEqual.lua
    │   │   ├── shallowEqual.spec.lua
    │   │   ├── testSelector.lua
    │   │   └── testSelector.spec.lua
    │   ├── Producer.spec
    │   │   ├── getDispatchers.spec.lua
    │   │   ├── getState.spec.lua
    │   │   ├── init.spec.lua
    │   │   ├── observe.spec.lua
    │   │   ├── observeWhile.spec.lua
    │   │   ├── once.spec.lua
    │   │   ├── resetState.spec.lua
    │   │   ├── setState.spec.lua
    │   │   ├── subscribe.spec.lua
    │   │   └── wait.spec.lua
    │   ├── Promise.lua
    │   ├── applyMiddleware.lua
    │   ├── applyMiddleware.spec.lua
    │   ├── combineProducers.lua
    │   ├── combineProducers.spec.lua
    │   ├── createProducer.lua
    │   ├── createSelector.lua
    │   ├── createSelector.spec.lua
    │   ├── index.d.ts
    │   ├── init.lua
    │   └── types.lua
    ├── test
    │   ├── src
    │   │   ├── client
    │   │   │   ├── producer
    │   │   │   │   ├── broadcast.client.ts
    │   │   │   │   ├── client-counter.ts
    │   │   │   │   └── index.ts
    │   │   │   └── selectors
    │   │   │       ├── client-counter.ts
    │   │   │       └── index.ts
    │   │   ├── server
    │   │   │   ├── benchmarks
    │   │   │   │   ├── combined-dispatch.bench.lua
    │   │   │   │   ├── create-selector.bench.lua
    │   │   │   │   ├── dispatch-with-middleware.bench.lua
    │   │   │   │   └── dispatch.bench.lua
    │   │   │   ├── producer
    │   │   │   │   ├── broadcast.server.ts
    │   │   │   │   ├── index.ts
    │   │   │   │   └── server-counter.ts
    │   │   │   ├── selectors
    │   │   │   │   ├── index.ts
    │   │   │   │   └── server-counter.ts
    │   │   │   └── test
    │   │   │       ├── stress-test.server.ts
    │   │   │       └── testez.server.ts
    │   │   └── shared
    │   │       ├── selectors
    │   │       │   ├── index.ts
    │   │       │   └── shared-counter.ts
    │   │       ├── slices
    │   │       │   ├── index.ts
    │   │       │   └── shared-counter.ts
    │   │       └── remotes.ts
    │   ├── default.project.json
    │   └── tsconfig.json
    ├── LICENSE.md
    ├── README.md
    ├── aftman.toml
    ├── default.project.json
    ├── package.json
    ├── pnpm-lock.yaml
    ├── selene.toml
    ├── testez-companion.toml
    ├── testez.toml
    ├── tsconfig.json
    ├── wally.lock
    └── wally.toml
::
```