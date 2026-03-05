# Repo Map: matter


# generated repo map
```
└── matter
    ├── LICENSE
    ├── docs
    │   ├── BestPractices
    │   │   ├── DerivedState.md
    │   │   ├── Reconciliation.md
    │   │   ├── StateMachines.md
    │   │   └── _category_.json
    │   ├── Guides
    │   │   ├── CollectionService.md
    │   │   ├── CommonMistakes.md
    │   │   ├── HotReloading.md
    │   │   ├── MatterDebugger.md
    │   │   ├── Replication.md
    │   │   └── _category_.json
    │   ├── Concepts.md
    │   ├── GettingStarted.md
    │   ├── Installation.md
    │   ├── WhyECS.md
    │   └── intro.md
    ├── example
    │   ├── assets
    │   │   ├── assets.rbxm
    │   │   ├── level.rbxm
    │   │   ├── lighting.rbxm
    │   │   └── terrain.rbxm
    │   ├── src
    │   │   ├── client
    │   │   │   ├── systems
    │   │   │   │   ├── roombasHurt.lua
    │   │   │   │   └── spinSpinners.lua
    │   │   │   └── receiveReplication.lua
    │   │   ├── server
    │   │   │   ├── systems
    │   │   │   │   ├── mothershipsSpawnRoombas.lua
    │   │   │   │   ├── playersAreTargets.lua
    │   │   │   │   ├── removeMissingModels.lua
    │   │   │   │   ├── replication.lua
    │   │   │   │   ├── roombasMove.lua
    │   │   │   │   ├── spawnMotherships.lua
    │   │   │   │   ├── spawnRoombas.lua
    │   │   │   │   └── updateTransforms.lua
    │   │   │   └── init.server.lua
    │   │   ├── shared
    │   │   │   ├── systems
    │   │   │   │   └── updateModelAttribute.lua
    │   │   │   ├── components.lua
    │   │   │   ├── setupTags.lua
    │   │   │   └── start.lua
    │   │   └── game.client.lua
    │   ├── README.md
    │   └── wally.toml
    ├── lib
    │   ├── debugger
    │   │   ├── widgets
    │   │   │   ├── codeText.lua
    │   │   │   ├── container.lua
    │   │   │   ├── entityInspect.lua
    │   │   │   ├── errorInspect.lua
    │   │   │   ├── frame.lua
    │   │   │   ├── hoverInspect.lua
    │   │   │   ├── link.lua
    │   │   │   ├── panel.lua
    │   │   │   ├── queryInspect.lua
    │   │   │   ├── realmSwitch.lua
    │   │   │   ├── selectionList.lua
    │   │   │   ├── tooltip.lua
    │   │   │   ├── valueInspect.lua
    │   │   │   └── worldInspect.lua
    │   │   ├── EventBridge.lua
    │   │   ├── clientBindings.lua
    │   │   ├── debugger.lua
    │   │   ├── formatTable.lua
    │   │   ├── hookWidgets.lua
    │   │   ├── hookWorld.lua
    │   │   ├── mouseHighlight.lua
    │   │   └── ui.lua
    │   ├── hooks
    │   │   ├── log.lua
    │   │   ├── useDeltaTime.lua
    │   │   ├── useEvent.lua
    │   │   ├── useEvent.spec.lua
    │   │   └── useThrottle.lua
    │   ├── mock
    │   │   └── BindableEvent.lua
    │   ├── Loop.lua
    │   ├── Loop.spec.lua
    │   ├── Queue.lua
    │   ├── World.lua
    │   ├── World.spec.lua
    │   ├── archetype.lua
    │   ├── archetype.spec.lua
    │   ├── component.lua
    │   ├── component.spec.lua
    │   ├── immutable.lua
    │   ├── init.lua
    │   ├── rollingAverage.lua
    │   ├── topoRuntime.lua
    │   └── topoRuntime.spec.lua
    ├── pages
    │   ├── home.css
    │   ├── index.js
    │   └── index.module.css
    ├── tests
    │   └── stressTest.client.lua
    ├── CHANGELOG.md
    ├── README.md
    ├── aftman.toml
    ├── default.project.json
    ├── example.project.json
    ├── moonwave.toml
    ├── selene.toml
    ├── test.project.json
    ├── testez.toml
    ├── tests.server.lua
    └── wally.toml
::
```