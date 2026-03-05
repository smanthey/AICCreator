# Repo Map: jecs


# generated repo map
```
└── jecs
    ├── LICENSE
    ├── examples
    │   ├── entities
    │   │   ├── basics.luau
    │   │   └── hierarchy.luau
    │   ├── hooks
    │   │   └── cleanup.luau
    │   ├── networking
    │   │   ├── networking_recv.luau
    │   │   ├── networking_send.luau
    │   │   ├── remotes.luau
    │   │   └── types.luau
    │   └── queries
    │       ├── archetypes
    │       │   ├── targets.luau
    │       │   └── visibility_cascades.luau
    │       ├── basics.luau
    │       ├── changetracking.luau
    │       ├── spatial_grids.luau
    │       └── wildcards.luau
    ├── how_to
    │   ├── 001_hello_world.luau
    │   ├── 002_entities.luau
    │   ├── 003_components.luau
    │   ├── 004_tags.luau
    │   ├── 005_entity_singletons.luau
    │   ├── 010_how_components_works.luau
    │   ├── 011_preregistering_components.luau
    │   ├── 012_entity_liveliness.luau
    │   ├── 013_pairs.luau
    │   ├── 020_queries.luau
    │   ├── 021_query_operators.luau
    │   ├── 022_query_caching.luau
    │   ├── 030_archetypes.luau
    │   ├── 040_fragmentation.luau
    │   ├── 041_entity_relationships.luau
    │   ├── 042_target.luau
    │   ├── 043_wildcards.luau
    │   ├── 100_cleanup_traits.luau
    │   ├── 110_hooks.luau
    │   ├── 111_signals.luau
    │   └── 999_temperance.luau
    ├── modules
    │   ├── BT
    │   │   └── module.luau
    │   ├── GetRect
    │   │   ├── examples
    │   │   │   └── button.luau
    │   │   └── module.luau
    │   ├── Input
    │   │   ├── examples
    │   │   │   └── example.luau
    │   │   └── module.luau
    │   ├── Jabby
    │   │   ├── client
    │   │   │   ├── apps
    │   │   │   │   ├── entity
    │   │   │   │   │   ├── systems
    │   │   │   │   │   │   └── obtain_entity_data.luau
    │   │   │   │   │   ├── add_component.luau
    │   │   │   │   │   ├── editor.luau
    │   │   │   │   │   ├── init.luau
    │   │   │   │   │   └── widget.luau
    │   │   │   │   ├── home
    │   │   │   │   │   ├── systems
    │   │   │   │   │   │   └── get_core_data.luau
    │   │   │   │   │   ├── init.luau
    │   │   │   │   │   └── widget.luau
    │   │   │   │   ├── overview_scheduler
    │   │   │   │   │   ├── systems
    │   │   │   │   │   │   └── get_scheduler_data.luau
    │   │   │   │   │   ├── init.luau
    │   │   │   │   │   ├── stack_bar.luau
    │   │   │   │   │   └── widget.luau
    │   │   │   │   ├── registry
    │   │   │   │   │   ├── systems
    │   │   │   │   │   │   ├── highlight_workspace_entity.luau
    │   │   │   │   │   │   ├── obtain_query_data.luau
    │   │   │   │   │   │   ├── send_workspace_entity.luau
    │   │   │   │   │   │   └── validate_query.luau
    │   │   │   │   │   ├── init.luau
    │   │   │   │   │   └── widget.luau
    │   │   │   │   └── system
    │   │   │   │       ├── systems
    │   │   │   │       │   └── replicate.luau
    │   │   │   │       ├── init.luau
    │   │   │   │       ├── watch_tracker.luau
    │   │   │   │       └── widget.luau
    │   │   │   ├── components
    │   │   │   │   ├── tooltip.luau
    │   │   │   │   └── virtualscroller_horizontal.luau
    │   │   │   ├── init.luau
    │   │   │   └── spawn_app.luau
    │   │   ├── examples
    │   │   │   └── example.luau
    │   │   ├── modules
    │   │   │   ├── average.luau
    │   │   │   ├── convert_units.luau
    │   │   │   ├── hash_connector.luau
    │   │   │   ├── lon.luau
    │   │   │   ├── loop.luau
    │   │   │   ├── net.luau
    │   │   │   ├── queue.luau
    │   │   │   ├── remotes.luau
    │   │   │   ├── reverse_connector.luau
    │   │   │   ├── signal.luau
    │   │   │   ├── traffic_check.luau
    │   │   │   ├── types.luau
    │   │   │   ├── videx.luau
    │   │   │   └── vm_id.luau
    │   │   ├── server
    │   │   │   ├── systems
    │   │   │   │   ├── entity.luau
    │   │   │   │   ├── mouse_pointer.luau
    │   │   │   │   ├── ping.luau
    │   │   │   │   ├── replicate_core.luau
    │   │   │   │   ├── replicate_registry.luau
    │   │   │   │   ├── replicate_scheduler.luau
    │   │   │   │   └── replicate_system_watch.luau
    │   │   │   ├── init.luau
    │   │   │   ├── public.luau
    │   │   │   ├── query_parser.luau
    │   │   │   ├── scheduler.luau
    │   │   │   ├── watch.luau
    │   │   │   └── world_hook.luau
    │   │   ├── ui
    │   │   │   ├── components
    │   │   │   │   ├── display
    │   │   │   │   │   ├── widget
    │   │   │   │   │   │   ├── borders.luau
    │   │   │   │   │   │   ├── init.luau
    │   │   │   │   │   │   └── topbar.luau
    │   │   │   │   │   ├── accordion.luau
    │   │   │   │   │   ├── background.luau
    │   │   │   │   │   ├── checkbox.luau
    │   │   │   │   │   ├── divider.luau
    │   │   │   │   │   ├── pages.luau
    │   │   │   │   │   ├── pane.luau
    │   │   │   │   │   ├── resizeable_bar.luau
    │   │   │   │   │   ├── scroll_frame.luau
    │   │   │   │   │   ├── snapping.luau
    │   │   │   │   │   ├── tablesheet.luau
    │   │   │   │   │   └── typography.luau
    │   │   │   │   ├── graph
    │   │   │   │   │   ├── bargraph.luau
    │   │   │   │   │   ├── graph.luau
    │   │   │   │   │   └── linegraph.luau
    │   │   │   │   ├── interactable
    │   │   │   │   │   ├── button.luau
    │   │   │   │   │   ├── select.luau
    │   │   │   │   │   └── textfield.luau
    │   │   │   │   └── util
    │   │   │   │       ├── container.luau
    │   │   │   │       ├── gap.luau
    │   │   │   │       ├── list.luau
    │   │   │   │       ├── padding.luau
    │   │   │   │       ├── portal.luau
    │   │   │   │       ├── rounded_frame.luau
    │   │   │   │       ├── row.luau
    │   │   │   │       ├── shadow.luau
    │   │   │   │       └── virtualscroller.luau
    │   │   │   ├── libraries
    │   │   │   │   ├── apcaw3.luau
    │   │   │   │   ├── cascade.luau
    │   │   │   │   ├── context.luau
    │   │   │   │   ├── delay.luau
    │   │   │   │   ├── oklab.luau
    │   │   │   │   └── store.luau
    │   │   │   ├── util
    │   │   │   │   ├── anim.luau
    │   │   │   │   ├── constants.luau
    │   │   │   │   ├── consume.luau
    │   │   │   │   ├── contrast.luau
    │   │   │   │   ├── oklch.luau
    │   │   │   │   ├── reduced_motion.luau
    │   │   │   │   └── theme.luau
    │   │   │   └── init.luau
    │   │   ├── vide
    │   │   │   ├── action.luau
    │   │   │   ├── apply.luau
    │   │   │   ├── batch.luau
    │   │   │   ├── bind.luau
    │   │   │   ├── changed.luau
    │   │   │   ├── cleanup.luau
    │   │   │   ├── context.luau
    │   │   │   ├── create.luau
    │   │   │   ├── defaults.luau
    │   │   │   ├── derive.luau
    │   │   │   ├── effect.luau
    │   │   │   ├── flags.luau
    │   │   │   ├── graph.luau
    │   │   │   ├── init.luau
    │   │   │   ├── maps.luau
    │   │   │   ├── mount.luau
    │   │   │   ├── read.luau
    │   │   │   ├── root.luau
    │   │   │   ├── show.luau
    │   │   │   ├── source.luau
    │   │   │   ├── spring.luau
    │   │   │   ├── switch.luau
    │   │   │   ├── throw.luau
    │   │   │   └── untrack.luau
    │   │   ├── jecs.luau
    │   │   └── module.luau
    │   ├── OB
    │   │   ├── examples
    │   │   │   └── example.luau
    │   │   └── module.luau
    │   ├── PerfGraph
    │   │   ├── perfgraph.py
    │   │   └── svg.py
    │   ├── Spring
    │   │   ├── examples
    │   │   │   └── example.luau
    │   │   ├── cframe.luau
    │   │   ├── color3.luau
    │   │   ├── generic.luau
    │   │   ├── number.luau
    │   │   ├── vector2.luau
    │   │   └── vector3.luau
    │   ├── collect.luau
    │   ├── deserialize.luau
    │   ├── entity_visualiser.luau
    │   ├── lifetime_tracker.luau
    │   ├── read_lcov.py
    │   ├── runtime_lints.luau
    │   └── testkit.luau
    ├── scripts
    │   └── alias_resolver.luau
    ├── src
    │   ├── jecs.d.ts
    │   └── jecs.luau
    ├── test
    │   ├── benches
    │   │   ├── data
    │   │   │   ├── image-1.png
    │   │   │   ├── image-2.png
    │   │   │   ├── image-3.png
    │   │   │   ├── image-4.png
    │   │   │   ├── image-5.png
    │   │   │   ├── jecs_darkmode.svg
    │   │   │   ├── jecs_lightmode.svg
    │   │   │   └── logo_old.png
    │   │   ├── visual
    │   │   │   ├── despawn.bench.luau
    │   │   │   ├── insertion.bench.luau
    │   │   │   ├── query.bench.luau
    │   │   │   ├── remove.bench.luau
    │   │   │   ├── spawn.bench.luau
    │   │   │   └── wally.toml
    │   │   ├── cached.luau
    │   │   ├── default.project.json
    │   │   ├── general.luau
    │   │   └── query.luau
    │   ├── entity_visualiser.luau
    │   ├── lol.luau
    │   ├── ob.luau
    │   ├── stress.client.luau
    │   ├── stress.project.json
    │   └── tests.luau
    ├── CHANGELOG.md
    ├── README.md
    ├── default.project.json
    ├── package.json
    ├── test.rbxl
    ├── tsconfig.json
    └── wally.toml
::
```