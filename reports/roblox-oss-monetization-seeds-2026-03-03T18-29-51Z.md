# Roblox OSS Monetization + Setup Seeds

Generated: 2026-03-03T18:30:18Z

## Repo list
- AeroGameFramework
- ByteNet
- Fusion
- Iris
- Knit
- MockDataStoreService
- Nature2D
- NevermoreEngine
- Roblox-Game-Template
- TopbarPlus
- ZonePlus
- creator-docs
- jecs
- knit-starter
- matter
- rbx-net
- reflex
- roact
- roact-rodux
- roblox-lua-promise
- rodux
- t
- nullpomino
- puyoai

## Monetization and economy keyword hits

### AeroGameFramework
```text
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/filelist.json:135:                        "name": "MockDataStoreService.lua"
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/filelist.min.json:1:{"url": "https://raw.githubusercontent.com/Sleitnick/AeroGameFramework/master/", "paths": {"type": "directory", "name": "src", "children": [{"type": "directory", "name": "ReplicatedFirst", "children": [{"type": "directory", "name": "Aero", "children": [{"type": "file", "name": "AeroLoad.client.lua"}]}]}, {"type": "directory", "name": "ReplicatedStorage", "children": [{"type": "directory", "name": "Aero", "children": [{"type": "directory", "name": "Internal", "children": [{"type": "file", "name": "Settings.lua"}]}, {"type": "directory", "name": "Shared", "children": [{"type": "file", "name": "Base64.lua"}, {"type": "file", "name": "Date.lua"}, {"type": "file", "name": "ListenerList.lua"}, {"type": "file", "name": "Maid.lua"}, {"type": "file", "name": "NumberUtil.lua"}, {"type": "file", "name": "Promise.lua"}, {"type": "file", "name": "Signal.lua"}, {"type": "file", "name": "StringUtil.lua"}, {"type": "file", "name": "TableUtil.lua"}, {"type": "file", "name": "Thread.lua"}, {"type": "file", "name": "VectorUtil.lua"}]}]}]}, {"type": "directory", "name": "ServerScriptService", "children": [{"type": "directory", "name": "Aero", "children": [{"type": "directory", "name": "Internal", "children": [{"type": "file", "name": "AeroServer.server.lua"}]}]}]}, {"type": "directory", "name": "ServerStorage", "children": [{"type": "directory", "name": "Aero", "children": [{"type": "directory", "name": "Modules", "children": [{"type": "directory", "name": "Data", "children": [{"type": "file", "name": "MockDataStoreService.lua"}, {"type": "file", "name": "init.lua"}]}, {"type": "file", "name": "ProfileService.lua"}]}]}]}, {"type": "directory", "name": "StarterPlayer", "children": [{"type": "directory", "name": "StarterPlayerScripts", "children": [{"type": "directory", "name": "Aero", "children": [{"type": "directory", "name": "Controllers", "children": [{"type": "file", "name": "Fade.lua"}, {"type": "file", "name": "TaskScheduler.lua"}, {"type": "directory", "name": "UserInput", "children": [{"type": "file", "name": "Gamepad.lua"}, {"type": "file", "name": "Keyboard.lua"}, {"type": "file", "name": "Mobile.lua"}, {"type": "file", "name": "Mouse.lua"}, {"type": "file", "name": "init.lua"}]}]}, {"type": "directory", "name": "Internal", "children": [{"type": "file", "name": "AeroClient.client.lua"}]}, {"type": "directory", "name": "Modules", "children": [{"type": "directory", "name": "CameraShaker", "children": [{"type": "file", "name": "CameraShakeInstance.lua"}, {"type": "file", "name": "CameraShakePresets.lua"}, {"type": "file", "name": "init.lua"}]}, {"type": "file", "name": "PID.lua"}, {"type": "directory", "name": "Smooth", "children": [{"type": "file", "name": "SmoothDamp.lua"}, {"type": "file", "name": "init.lua"}]}, {"type": "directory", "name": "Tween", "children": [{"type": "file", "name": "Easing.lua"}, {"type": "file", "name": "init.lua"}]}]}]}]}]}]}}
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:1:-- Mock DataStoreService
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:11:		local dataStoreService = game:GetService("DataStoreService")
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:15:			dataStoreService = require(game.ServerStorage.MockDataStoreService)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:18:		-- dataStoreService will act exactly like the real one
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:24:	that hasn't been overridden (such as dataStoreService.Name), it
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:25:	will reference the actual property in the real dataStoreService.
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:28:		This has been created based off of the DataStoreService on
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:36:local DataStoreService = {}
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:43:local realDataStoreService = game:GetService("DataStoreService")
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:47:	warn("Mocked DataStoreService is functioning on the client: The real DataStoreService will not work on the client")
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:54:function API:GetDataStore(name, scope)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:55:	assert(type(name) == "string", "DataStore name must be a string; got" .. type(name))
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:56:	assert(type(scope) == "string" or scope == nil, "DataStore scope must be a string; got" .. type(scope))
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:121:function API:GetGlobalDataStore()
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:122:	return self:GetDataStore("global", "global")
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:126:function API:GetOrderedDataStore(name, scope)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:127:	local dataStore = self:GetDataStore(name, scope)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:131:		return dataStore:GetAsync(k)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:135:		dataStore:SetAsync(k, v)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:139:		dataStore:UpdateAsync(k, function(oldValue)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:147:		dataStore:IncrementAsync(k, delta)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:151:		dataStore:RemoveAsync(k)
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:206:function API:GetRequestBudgetForRequestType(requestType)
```

### ByteNet
No keyword hits in first-pass scan.

### Fusion
```text
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/fundamentals/computeds.md:51:occur (e.g. waiting for a server to respond to a request).
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/assets/theme/admonition.css:36:.md-typeset .question {
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:7:## I need help or have a question
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:14:Please don't submit issues to the repository to ask a question. Prefer to start a
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:58:## I have an idea, suggestion or feature request
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:71:### Open a new issue, describing the feature request
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:76:feature request should describe the general case for why a feature should be
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:77:added. Focus on who your feature request would help, when it would help them
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:85:- Most feature requests originate from valid concerns, but might need work to
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:91:### Tips for good feature requests
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:101:### Things to avoid in feature requests
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:121:- New features without existing feature requests are closed on principle. Pull
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:122:requests aren't the place to introduce new ideas suddenly.
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:131:### Create a new branch and draft a pull request
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:133:- Create a pull request as soon as possible and mark it as a draft while you
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:138:you aim to achieve with the pull request.
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:140:- Keep your pull requests small and specifically targeted; for example, by
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:141:separating different features into different pull requests.
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:157:- If we decide your pull request doesn't quite align with Fusion, then we'll
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/CONTRIBUTING.md:159:close pull requests for personal reasons.
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/examples/cookbook/fetch-data-from-server.md:128:so the request is sent out automatically.
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/best-practices/optimisation.md:164:??? question "Why won't Fusion skip those updates?"
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/best-practices/optimisation.md:191:According to the similarity test (and the question section above), one way to
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/get-started/developer-tools.md:27:??? question "Have a new tool for this page?"
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/get-started/developer-tools.md:62:	[open a pull request with your changes](https://github.com/dphfox/Fusion/pulls) 
```

### Iris
```text
/Users/tatsheen/claw-repos/oss-index/roblox/Iris/lib/init.lua:244:    Internal._globalRefreshRequested = true
/Users/tatsheen/claw-repos/oss-index/roblox/Iris/lib/init.lua:339:Internal._globalRefreshRequested = false -- UpdatingGlobalConfig changes this to true, leads to Root being generated twice.
/Users/tatsheen/claw-repos/oss-index/roblox/Iris/lib/Types.lua:207:    _globalRefreshRequested: boolean,
/Users/tatsheen/claw-repos/oss-index/roblox/Iris/lib/Internal.lua:25:    Internal._globalRefreshRequested = false -- refresh means that all GUI is destroyed and regenerated, usually because a style change was made and needed to be propogated to all UI
/Users/tatsheen/claw-repos/oss-index/roblox/Iris/lib/Internal.lua:243:        if Internal._globalRefreshRequested then
/Users/tatsheen/claw-repos/oss-index/roblox/Iris/lib/Internal.lua:247:            Internal._globalRefreshRequested = false
/Users/tatsheen/claw-repos/oss-index/roblox/Iris/lib/demoWindow.lua:385:                    Iris.Text({ "Very important questions." })
```

### Knit
```text
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/ARCHIVAL.md:15:As Knit steps away from the Roblox ecosystem, a good question to ask is: What role did Knit serve?
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/middleware.md:9:Middleware can be used to both transform inbound/outbound arguments, and also decide to drop requests/responses. This is useful for many use-cases, such as automatically serializing/deserializing complex data types over the network, or sanitizing incoming data.
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/middleware.md:17:Each function should return a boolean, indicating whether or not to continue to the request/response. If `false`, an optional variadic list of items can be returned, which will be returned back to the caller (essentially a short-circuit, but still returning data).
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/gettingstarted.md:51:A service is simply a structure that _serves_ some specific purpose. For instance, a game might have a MoneyService, which manages in-game currency for players. Let's look at a simple example:
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/gettingstarted.md:65:	local money = someDataStore:GetAsync("money")
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/gettingstarted.md:73:	someDataStore:SetAsync("money", money)
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/README.md:50:A service is simply a structure that _serves_ some specific purpose. For instance, a game might have a MoneyService, which manages in-game currency for players. Let's look at a simple example:
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/README.md:64:	local money = someDataStore:GetAsync("money")
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/README.md:72:	someDataStore:SetAsync("money", money)
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/intellisense.md:23:Thus, the question at hand is: **How do we get Luau to understand the _type_ of our service?**
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/intellisense.md:102:A fair question to ask is: Why is this not the preferred setup for Knit?
```

### MockDataStoreService
```text
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/wally.toml:2:name = "buildthomas/mockdatastoreservice"
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/wally.toml:3:description = "Emulation of Roblox's DataStoreService for seamless offline development & testing"
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/rotriever.toml:2:name = "buildthomas/MockDataStoreService"
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/default.project.json:2:  "name": "DataStoreService",
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/place.project.json:2:    "name": "MockDataStoreService Test Place",
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/place.project.json:9:        "DataStoreService": {
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/place.project.json:13:        "TestDataStoreService": {
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/place.project.json:25:        "MockDataStoreServiceTests": {
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/bin/run-tests.server.lua:7:local results = TestEZ.TestBootstrap:run(ServerStorage.TestDataStoreService, TestEZ.Reporters.TextReporter)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:2:	DataStoreService.lua
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:3:	This module decides whether to use actual datastores or mock datastores depending on the environment.
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:6:	https://github.com/buildthomas/MockDataStoreService/blob/master/LICENSE
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:9:local MockDataStoreServiceModule = script.MockDataStoreService
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:17:		game:GetService("DataStoreService"):GetDataStore("__TEST"):SetAsync("__TEST", "__TEST_" .. os.time())
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:20:		-- Can connect to datastores, but no API access
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:27:	warn("INFO: Using MockDataStoreService instead of DataStoreService")
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:28:	return require(MockDataStoreServiceModule)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/init.lua:30:	return game:GetService("DataStoreService")
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/README.md:1:<h1 align="center">MockDataStoreService</h1>
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/README.md:3:    <a href="https://travis-ci.com/buildthomas/MockDataStoreService">
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/README.md:4:        <img src="https://travis-ci.com/buildthomas/MockDataStoreService.svg?branch=master" />
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/README.md:6:    <!--<a href="https://coveralls.io/github/buildthomas/MockDataStoreService?branch=master">
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/README.md:7:        <img src="https://coveralls.io/repos/github/buildthomas/MockDataStoreService/badge.svg?branch=master" />
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/README.md:12:    <b>Emulation of Roblox's DataStoreService for seamless offline development & testing</b>
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/README.md:17:This is a set of modules that emulates datastores in Lua rather than using the actual service. This is useful for testing in offline projects / local place files with code/frameworks that need to have access to datastores.
```

### Nature2D
```text
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/CONTRIBUTING.md:3:All issues and pull requests are welcome! This guide goes through everything you need to know before contributing to the project. Nature2D is in early beta, hence it looks for contribution at all times!
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/CONTRIBUTING.md:7:Found a bug, want to file a feature request, have a query or would like to discuss about Nature2D? Open an issue! But before you do, here are some things to keep in mind.
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/CONTRIBUTING.md:9:* **Don't ask to ask** - Don't ask to ask! Questions are always welcome without any judgement, whatever your question may be, feel free to ask without hesitation! 
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/CONTRIBUTING.md:33:# Pull Requests
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/CONTRIBUTING.md:35:Fixed mistakes or bugs, have an enhancement, integrated a new feature, updated the code or proposed small changes? Open a pull request! But before you do, here are some things to keep in mind.
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/CONTRIBUTING.md:40:* **Review your Pull Request** - Before opening the PR, review it yourself! Check if you made any mistakes, check if you introduced a new bug, check if you edited the right files etc.
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/CONTRIBUTING.md:50:* **Delete your branch after the PR has been merged** - It is advisable to delete the branch you created for the pull request after it has been merged to the main project!
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/CONTRIBUTING.md:54:If you open an issue or a pull request, we will review and process them. Patience is key! 
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/README.md:20:Created something cool with Nature2D? Open an [issue](https://github.com/jaipack17/Nature2D/issues) or a [pull request](https://github.com/jaipack17/Nature2D/pulls) if you wish to showcase it here!
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/README.md:64:If you encounter bugs or would like to support this project by improving the code, adding new features or fixing bugs - Feel free to open issues and pull requests. Also read the [contribution guide](https://github.com/jaipack17/Nature2D/blob/master/CONTRIBUTING.md).
/Users/tatsheen/claw-repos/oss-index/roblox/Nature2D/docs/README.md:7:To get familiar with Nature2D and quickly adopt it into your codebase, you may go through the documentation which goes through how Nature2D works, its api, usage, examples and placefiles to give you a broad idea about the library. If you spot any errors in the documentation, please open an issue or a pull request with the fix! Thanks!
```

### NevermoreEngine
```text
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/playerinputmode/src/Client/PlayerInputModeServiceClient.lua:65:					remoteEvent:FireServer(PlayerInputModeServiceConstants.REQUEST_SET_INPUT_MODE, modeType)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:53:* [DataStore](https://quenty.github.io/NevermoreEngine/api/DataStore) - Battle-tested datastore wrapper
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:72:| [Aggregator](https://quenty.github.io/NevermoreEngine/api/AggregatorUtils) | Aggregates async promise requests | `npm i @quenty/aggregator` | [docs](https://quenty.github.io/NevermoreEngine/api/AggregatorUtils) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/aggregator) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/aggregator/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/aggregator) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:90:| [BodyColorsUtils](https://quenty.github.io/NevermoreEngine/api/BodyColorsDataUtils) | Body color helper utilities for merging and representing body colors over the network and datastore | `npm i @quenty/bodycolorsutils` | [docs](https://quenty.github.io/NevermoreEngine/api/BodyColorsDataUtils) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/bodycolorsutils) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/bodycolorsutils/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/bodycolorsutils) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:125:| [DataStore](https://quenty.github.io/NevermoreEngine/api/DataStore) | Quenty's Datastore implementation for Roblox | `npm i @quenty/datastore` | [docs](https://quenty.github.io/NevermoreEngine/api/DataStore) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/datastore) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/datastore/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/datastore) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:138:| [ExperienceCalculator](https://quenty.github.io/NevermoreEngine/api/ExperienceUtils) | Calculate experience on an exponential curve and perform relevant calculations Uses formulas from stackoverflow.com/questions/6954874/php-game-formula-to-calculate-a-level-based-on-exp | `npm i @quenty/experiencecalculator` | [docs](https://quenty.github.io/NevermoreEngine/api/ExperienceUtils) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/experiencecalculator) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/experiencecalculator/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/experiencecalculator) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:163:| [HttpPromise](https://quenty.github.io/NevermoreEngine/api/HttpPromise) | HttpPromise - Wrapper functions around http requests in Roblox. | `npm i @quenty/httppromise` | [docs](https://quenty.github.io/NevermoreEngine/api/HttpPromise) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/httppromise) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/httppromise/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/httppromise) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:192:| [MarketplaceUtils](https://quenty.github.io/NevermoreEngine/api/MarketplaceUtils) | Provides utility methods for MarketplaceService | `npm i @quenty/marketplaceutils` | [docs](https://quenty.github.io/NevermoreEngine/api/MarketplaceUtils) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/marketplaceutils) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/marketplaceutils/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/marketplaceutils) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:258:| [ResetService](https://quenty.github.io/NevermoreEngine/api/ResetService) | Handles reset requests since Roblox's reset system doesn't handle ragdolls correctly | `npm i @quenty/resetservice` | [docs](https://quenty.github.io/NevermoreEngine/api/ResetService) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/resetservice) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/resetservice/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/resetservice) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/influxdbclient/src/Server/InfluxDBClient.story.lua:45:	maid:GiveTask(writeAPI.RequestFinished:Connect(function(response)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/docs/conventions/typescript.md:130:throw err;  // user sees "Error: Request failed with status code 403" + stack trace
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/docs/conventions/git-workflow.md:25:Use `git rebase -i` to craft clean commit history before pushing or requesting review:
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/docs/conventions/git-workflow.md:54:## Pull request descriptions
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/docs/conventions/git-workflow.md:68:The best PRs include a demo — a screenshot or short video showing the change in action. This is especially valuable for UI changes, new CLI output, or CI improvements where the effect isn't obvious from code alone. For performance or infrastructure changes, include before/after numbers — wall-clock times, request counts, or resource usage. Concrete measurements are more convincing than qualitative claims and help reviewers gauge whether the trade-offs are worth it.
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/Aggregator.lua:3:	Aggregates all requests into one big send request to deduplicate the request
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/Aggregator.lua:90:	self:_queueBatchRequests()
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/Aggregator.lua:158:function Aggregator._queueBatchRequests<T>(self: Aggregator<T>): ()
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/RateAggregator.lua:28:			_maxRequestsPerSecond: number,
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/RateAggregator.lua:47:	self._maxRequestsPerSecond = 50
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/RateAggregator.lua:62:function RateAggregator.SetMaxRequestsPerSecond<TArgs..., T...>(self: RateAggregator<TArgs..., T...>, maxRequestPerSecond: number)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/RateAggregator.lua:63:	self._maxRequestsPerSecond = maxRequestPerSecond
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/RateAggregator.lua:102:		if timeSinceLastQuery < 1 / self._maxRequestsPerSecond then
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/RateAggregator.lua:104:			task.wait(1 / self._maxRequestsPerSecond)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/aggregator/src/Shared/RateAggregator.lua:115:			local thisStepWaitTime = 1 / self._maxRequestsPerSecond
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/playerinputmode/src/Shared/PlayerInputModeServiceConstants.lua:13:	REQUEST_SET_INPUT_MODE = "requestSetInputMode",
```

### Roblox-Game-Template
```text
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/shared/Configs/PlayerData.lua:1:export type Currency = "coins" | "gems"
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/client/Controllers/Guis/CurrencyController.lua:10:local Gui = GuiController.Guis.Currency
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Services/PlayerDataService.lua:12:local DATASTORE_NAME = "Production"
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Services/PlayerDataService.lua:15:    DATASTORE_NAME = "Development"
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Services/PlayerDataService.lua:27:Local.ProfileStore = ProfileStore.GetProfileStore(DATASTORE_NAME, PlayerData)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Commands/AdjustBalanceServer.lua:7:return function (context, currency: PlayerData.Currency, amount: number, player: Player?)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Commands/AdjustBalanceServer.lua:9:    Store.updateBalance(tostring(player.UserId), currency, amount)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/client/Controllers/GuiController.lua:10:    Currency = PlayerGui:WaitForChild("Currency"),
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/README.md:71:- Currency labels UI created and hooked into the State.
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/README.md:73:- Utilize the AdjustBalance command from Cmdr to adjust a player's currency amount.
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/shared/Store/Slices/Players/Balance.lua:17:    updateBalance: (playerId: string, currency: PlayerData.Currency, amount: number) -> (),
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/shared/Store/Slices/Players/Balance.lua:31:    updateBalance = function(state, playerId: string, currency: PlayerData.Currency, amount: number)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/shared/Store/Slices/Players/Balance.lua:37:            return Sift.Dictionary.set(balance, currency, balance[currency] + amount)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Commands/AdjustBalance.lua:8:			Type = "currency";
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Commands/AdjustBalance.lua:9:			Name = "Currency";
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Types/Currency.lua:7:for currency, _ in PlayerData.balance do
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Types/Currency.lua:8:	table.insert(currencies, currency)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Types/Currency.lua:12:	registry:RegisterType("currency", registry.Cmdr.Util.MakeEnumType("currency", currencies))
```

### TopbarPlus
```text
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/src/VERSION.lua:23:			return game:GetService("MarketplaceService"):GetProductInfo(DEVELOPMENT_PLACE_ID)
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/docs/index.md:92:Have a question or issue? Feel free to reach out at the [TopbarPlus DevForum Thread].
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/docs/contributing.md:13:## Questions and Feedback
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/docs/contributing.md:14:- Be sure to first check out the documentation before asking a question.
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/docs/contributing.md:15:- We recommend asking all questions and posting feedback to the [discussion thread].
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/docs/contributing.md:26:- For smaller contributions (a few lines of code, fixing typos, etc) feel free to send a pull request right away.
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/docs/contributing.md:27:- Make sure to merge your pull requests into the #development branch.
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/docs/contributing.md:34:- If you find any problems in the documentation, including typos, bad grammar, misleading phrasing, or missing content, feel free to file issues and pull requests to fix them.
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/docs/contributing.md:48:    All pull requests must be made to the ***development*** branch.
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/src/Elements/Widget.lua:197:		-- We defer changes by a frame to eliminate all but 1 requests which
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/src/Elements/Widget.lua:198:		-- could otherwise stack up to 20+ requests in a single frame
/Users/tatsheen/claw-repos/oss-index/roblox/TopbarPlus/src/init.lua:391:	-- client respawns. This solves one of the most asked about questions on the post
```

### ZonePlus
```text
/Users/tatsheen/claw-repos/oss-index/roblox/ZonePlus/docs/contributing.md:13:## Questions and Feedback
/Users/tatsheen/claw-repos/oss-index/roblox/ZonePlus/docs/contributing.md:14:- Be sure to check out the documentation and [resources] first before asking a question.
/Users/tatsheen/claw-repos/oss-index/roblox/ZonePlus/docs/contributing.md:15:- We recommend submitting all questions and feedback to the [discussion thread].
/Users/tatsheen/claw-repos/oss-index/roblox/ZonePlus/docs/contributing.md:16:- You can also [open an issue] with label ``Type: Question``.
/Users/tatsheen/claw-repos/oss-index/roblox/ZonePlus/docs/contributing.md:33:- If you find any problems in the documentation, including typos, bad grammar, misleading phrasing, or missing content, feel free to file issues and pull requests to fix them.
/Users/tatsheen/claw-repos/oss-index/roblox/ZonePlus/docs/contributing.md:47:    All pull requests must be made to the ***development*** branch.
```

### creator-docs
```text
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CODE_OF_CONDUCT.md:75:For answers to common questions about this code of conduct, see the FAQ at
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CONTRIBUTING.md:21:For instructions on keeping your fork in sync with `Roblox/creator-docs` over time, see [Syncing a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork).
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CONTRIBUTING.md:47:## Opening Pull Requests
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CONTRIBUTING.md:59:Then open [`Roblox/creator-docs`](https://github.com/Roblox/creator-docs/pulls) on GitHub and click **New Pull Request**. Choose **main** as the _base_ branch and your branch as the _compare_ branch.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CONTRIBUTING.md:61:Add a title and description of your changes, confirm that the contribution is your own, original work that you have the right to submit, and create the pull request.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/STYLE.md:3:This document contains guidelines for our content. The document is subject to change and **not** comprehensive. If you have suggestions, open an issue or submit a pull request.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/STYLE.md:172:      <td><code>`Class.MarketplaceService:GetProductInfo()`</code></td>
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/STYLE.md:173:      <td><code><a href="https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#GetProductInfo">MarketplaceService:GetProductInfo()</a></code></td>
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/STYLE.md:176:      <td><code>`Class.MarketplaceService:GetProductInfo()|GetProductInfo()`</code></td>
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/STYLE.md:177:      <td><code><a href="https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#GetProductInfo">GetProductInfo()</a></code></td>
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/STYLE.md:219:- **BAD**: [`MarketplaceService`](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService) is responsible for in-experience transactions. The most notable methods are [`MarketplaceService:PromptProductPurchase()`](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#PromptProductPurchase) and [`MarketplaceService:PromptPurchase()`](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#PromptPurchase), as well as the callback [`MarketplaceService.ProcessReceipt`](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#ProcessReceipt) which must be defined so that transactions do not fail.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/STYLE.md:220:- **BETTER**: [`MarketplaceService`](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService) is responsible for in-experience transactions. The most notable methods are [`PromptProductPurchase()`](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#PromptProductPurchase) and [`PromptPurchase()`](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#PromptPurchase), as well as the callback [`ProcessReceipt`](https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#ProcessReceipt) which must be defined so that transactions do not fail.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/LICENSE:48:     rights in the material. A licensor may make special requests,
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/LICENSE:51:     respect those requests where reasonable. More considerations
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/LICENSE:225:                    attribution, in any reasonable manner requested by
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/LICENSE:253:       3. If requested by the Licensor, You must remove any of the
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:7:If you're unfamiliar with the GitHub contribution process, see [About pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests) and the following video.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:13:If you find a problem with the documentation and don't want to submit a pull request, please let us know by [reporting it on the Roblox developer forums](https://devforum.roblox.com/w/bug-report/).
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:21:When you submit a pull request for review, you must agree to the following:
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:35:1. Ensure that the base repository is `Roblox/creator-docs` and the base branch is `main`. Verify that you're happy with your changes and click **Create pull request**.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:36:1. Finally, fill out the details in the pull request description and click **Create pull request**.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:50:1. Click **Compare & pull request**.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:52:1. Finally, fill out the details in the pull request description and click **Create pull request**.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:54:Alternatively, you can use the **GitHub** or **GitHub Pull Request** menus in github.dev to submit the pull request. For documentation on using github.dev, see [GitHub Codespaces](https://docs.github.com/en/codespaces/the-githubdev-web-based-editor).
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:66:1. Commit, push to your fork, and submit your pull request against this repository's `main` branch.
```

### jecs
```text
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/how_to/020_queries.luau:33:	component. To match a query, an entity must have all the requested components.
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/examples/networking/networking_send.luau:105:    -- local requested_snapshots = collect(remotes.request_snapshot.OnServerEvent)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/examples/networking/networking_send.luau:112:        -- In the future maybe it should be requested by the player instead when they
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/how_to/999_temperance.luau:9:interesting and novel functionality. If it doesn't, perhaps it is time to ask questions.
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/modules/remotes.luau:60:	Requests the server to validate a query
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/modules/remotes.luau:77:	Requests a server to initiate replication of a query.
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/modules/remotes.luau:84:	request_query =
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/modules/remotes.luau:146:	Requests a server to initiate replication of a scheduler
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/modules/remotes.luau:148:	request_scheduler =
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/modules/remotes.luau:153:	Requests the server to stop replicating a scheduler
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/modules/remotes.luau:321:	request_watch_data =
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/modules/remotes.luau:322:		net.create_event("request_watch_data") ::
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/client/apps/registry/systems/obtain_query_data.luau:83:			-- print("requesting new query", current_query_id)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/client/apps/registry/systems/obtain_query_data.luau:84:			remotes.request_query:fire(outgoing, context.id, current_query_id, context.query())
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_scheduler.luau:14:	local request_scheduler = queue(remotes.request_scheduler)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_scheduler.luau:20:		for incoming, id in request_scheduler:iter() do
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_registry.luau:59:	local request_query = queue(remotes.request_query)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_registry.luau:240:		for incoming, world_id, query_id, query in request_query:iter() do
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_system_watch.luau:115:	local request_create_watch = queue(remotes.create_watch)	
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_system_watch.luau:116:	local request_remove_watch = queue(remotes.remove_watch)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_system_watch.luau:117:	local request_watch_data = queue(remotes.request_watch_data)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_system_watch.luau:118:	local request_stop_watch = queue(remotes.stop_watch)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_system_watch.luau:119:	local request_record_watch = queue(remotes.start_record_watch)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_system_watch.luau:120:	local request_connect_watch = queue(remotes.connect_watch)
/Users/tatsheen/claw-repos/oss-index/roblox/jecs/modules/Jabby/server/systems/replicate_system_watch.luau:121:	local request_disconnect_watch = queue(remotes.disconnect_watch)
```

### knit-starter
```text
/Users/tatsheen/claw-repos/oss-index/roblox/knit-starter/README.md:27:    As of writing this Imo the best way to handle Datastores as it 
```

### matter
```text
/Users/tatsheen/claw-repos/oss-index/roblox/matter/lib/World.lua:424:	@return ...ComponentInstance -- The requested component values
/Users/tatsheen/claw-repos/oss-index/roblox/matter/lib/World.lua:500:	@return () -> (id, ...ComponentInstance) -- Iterator of entity ID followed by the requested component values
```

### rbx-net
```text
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/client/ClientAsyncFunction.ts:148:				reject("Request to server timed out after " + this.timeout + " seconds");
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/internal/index.ts:15:export interface RequestCounter {
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/server/ServerAsyncFunction.ts:180:				reject("Request to client timed out");
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:1:import { format, IS_SERVER, NetManagedInstance, RequestCounter, ServerTickFunctions } from "../../internal";
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:5:const throttles = new Map<NetManagedInstance, RequestCounter>();
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:13:	MaxRequestsPerMinute: number;
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:17:	MaxRequestsPerMinute: number;
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:19:	 * @default "Request limit exceeded ({limit}) by {player} via {remote}"
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:38: * Will limit the amount of requests a player can make to this event
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:41: * @param maxRequestsPerMinute The maximum requests per minute
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:44:	const maxRequestsPerMinute = options.MaxRequestsPerMinute;
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:46:	const throttleMessage = options.ThrottleMessage ?? "Request limit exceeded ({limit}) by {player} via {remote}";
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:57:			if (count >= maxRequestsPerMinute) {
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:62:						limit: maxRequestsPerMinute,
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/index.ts:64:					MaxRequestsPerMinute: maxRequestsPerMinute,
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:4:local RequestCounter = {}
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:5:RequestCounter.__index = RequestCounter
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:7:function RequestCounter.new()
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:12:	return setmetatable(self, RequestCounter)
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:15:function RequestCounter:Get(player)
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:21:function RequestCounter:Increment(player)
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:32:function RequestCounter:__tostring()
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:33:	return "RequestCounter"
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:36:function RequestCounter:ClearAll()
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/middleware/RateLimitMiddleware/throttle.lua:45:		local newCounter = RequestCounter.new()
```

### reflex
```text
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/src/index.d.ts:159: * server. It will request the initial state from the server and will dispatch
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/docs/reference/reflex/create-broadcaster.md:179:-   `player` - The player who requested state. Should be received from a remote event call.
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/docs/reference/reflex/create-broadcast-receiver.md:84:`createBroadcastReceiver` will request the server's shared state when the middleware is applied, and _merge_ it with the client's state. This means that the client's state will not be overwritten, but instead hydrated with the server's state. It is safe to use your producer before the server's state is received.
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:113:      '@algolia/requester-common': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:120:      '@algolia/requester-common': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:128:      '@algolia/requester-common': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:136:      '@algolia/requester-common': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:154:  /@algolia/requester-browser-xhr@4.20.0:
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:157:      '@algolia/requester-common': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:160:  /@algolia/requester-common@4.20.0:
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:164:  /@algolia/requester-node-http@4.20.0:
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:167:      '@algolia/requester-common': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:175:      '@algolia/requester-common': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:900:    resolution: {integrity: sha512-vIpJFNM/FjZ4rh1myqIya9jXwrwwgFRHPjT3DkUA9ZLHuzox8jiXkOLvwm1H+PQIP3CqfC++WPKeuDi0Sjdj1g==}
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:2521:    resolution: {integrity: sha512-BcCkm/STipKvbCl6b7QFrMh/vx00vIP63k2eM66MfHJzPr6O2U0jYEViXkHJWqXqQYjdeA9cuCl5KWmlwjDvbA==}
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:3130:      '@algolia/requester-browser-xhr': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:3131:      '@algolia/requester-common': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:3132:      '@algolia/requester-node-http': 4.20.0
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:3238:    resolution: {integrity: sha512-cD8FOb0tRH3uuEe6+evtAbgJtfxr7ly3fQjYcMcuPlgkwVS9xboaVIpcDV+cYQe+yGykgwZCs1pzjntcGa6l5g==}
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:3441:  /cacheable-request@6.1.0:
/Users/tatsheen/claw-repos/oss-index/roblox/reflex/docs/pnpm-lock.yaml:4877:      cacheable-request: 6.1.0
```

### roact
```text
/Users/tatsheen/claw-repos/oss-index/roblox/roact/CONTRIBUTING.md:9:## Feature Requests
/Users/tatsheen/claw-repos/oss-index/roblox/roact/CONTRIBUTING.md:10:If there are any features you think are missing from Roact, you can post a request in the [GitHub issue tracker](https://github.com/Roblox/Roact/issues).
/Users/tatsheen/claw-repos/oss-index/roblox/roact/CONTRIBUTING.md:12:Just like bug reports, take a peak at the issue tracker for duplicates before opening a new feature request.
/Users/tatsheen/claw-repos/oss-index/roblox/roact/CONTRIBUTING.md:54:## Pull Requests
/Users/tatsheen/claw-repos/oss-index/roblox/roact/CONTRIBUTING.md:55:Before starting a pull request, open an issue about the feature or bug. This helps us prevent duplicated and wasted effort. These issues are a great place to ask for help if you run into problems!
/Users/tatsheen/claw-repos/oss-index/roblox/roact/CONTRIBUTING.md:57:Before you submit a new pull request, check:
/Users/tatsheen/claw-repos/oss-index/roblox/roact/CONTRIBUTING.md:79:Add a link to your pull request in the entry. We don't need to link to the related GitHub issue, since pull requests will also link to them.
/Users/tatsheen/claw-repos/oss-index/roblox/roact/docs/api-reference.md:493:`setState` *requests* an update to the component's state. Roact may schedule this update for a later time or resolve it immediately.
/Users/tatsheen/claw-repos/oss-index/roblox/roact/docs/api-reference.md:640:`didUpdate` is a good place to send network requests or dispatch Rodux actions, but make sure to compare `self.props` and `self.state` with `previousProps` and `previousState` to avoid triggering too many updates.
/Users/tatsheen/claw-repos/oss-index/roblox/roact/docs/guide/state-and-lifecycle.md:42:Lifecycle methods are a great place to send off network requests, measure UI ([with the help of refs](../../advanced/bindings-and-refs#refs)), wrap non-Roact components, and produce other side-effects.
/Users/tatsheen/claw-repos/oss-index/roblox/roact/src/Component.lua:199:	if a requested context key is not present
```

### roact-rodux
```text
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/CODE_OF_CONDUCT.md:82:behavior was inappropriate. A public apology may be requested.
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/CODE_OF_CONDUCT.md:125:For answers to common questions about this code of conduct, see the FAQ at
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/selene.toml:8:# feature request for this config: https://github.com/Kampfkarren/selene/issues/181
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/selene.toml:12:# remove this once the feature request here is implemented: https://github.com/Kampfkarren/selene/issues/181
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/CONTRIBUTING.md:9:## Feature Requests
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/CONTRIBUTING.md:10:If there are any features you think are missing from RoactRodux, you can post a request in the [GitHub issue tracker](https://github.com/Roblox/RoactRodux/issues).
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/CONTRIBUTING.md:12:Just like bug reports, take a peak at the issue tracker for duplicates before opening a new feature request.
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/CONTRIBUTING.md:50:## Pull Requests
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/CONTRIBUTING.md:51:Before starting a pull request, open an issue about the feature or bug. This helps us prevent duplicated and wasted effort. These issues are a great place to ask for help if you run into problems!
/Users/tatsheen/claw-repos/oss-index/roblox/roact-rodux/CONTRIBUTING.md:53:Before you submit a new pull request, check:
```

### roblox-lua-promise
```text
/Users/tatsheen/claw-repos/oss-index/roblox/roblox-lua-promise/docs/WhyUsePromises.md:13:But sometimes situations arise where we call a function that needs access to a value that *doesn't* exist at call time. This could be because it requires a network request to get the data, or the user needs to input some text, or we're waiting for another process to finish computation and give us the value. In any case, we refer to this as an "asynchronous operation".
/Users/tatsheen/claw-repos/oss-index/roblox/roblox-lua-promise/docs/WhyUsePromises.md:25:So, what really happens when we call an asynchronous function like `Player:IsInGroup`? Well, the current Lua thread yields (letting other Lua code start running elsewhere in your game), and Roblox makes a new OS thread which blocks on an HTTP request to their internal group APIs in the background. Sometime in the future when that request comes back, the value jumps back onto the main Roblox thread and your Lua thread is scheduled to be resumed with the given arguments on the next step.
```

### rodux
```text
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/CONTRIBUTING.md:9:## Feature Requests
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/CONTRIBUTING.md:10:If there are any features you think are missing from Rodux, you can post a request in the [GitHub issue tracker](https://github.com/Roblox/Rodux/issues).
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/CONTRIBUTING.md:12:Just like bug reports, take a peak at the issue tracker for duplicates before opening a new feature request.
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/CONTRIBUTING.md:49:## Pull Requests
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/CONTRIBUTING.md:50:Before starting a pull request, open an issue about the feature or bug. This helps us prevent duplicated and wasted effort. These issues are a great place to ask for help if you run into problems!
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/CONTRIBUTING.md:52:Before you submit a new pull request, check:
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/selene.toml:8:# feature request for this config: https://github.com/Kampfkarren/selene/issues/181
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/selene.toml:12:# remove this once the feature request here is implemented: https://github.com/Kampfkarren/selene/issues/181
/Users/tatsheen/claw-repos/oss-index/roblox/rodux/docs/advanced/middleware.md:5:- Performing a network request in response to an `action` and storing the response in the `state`.
```

### t
No keyword hits in first-pass scan.

### nullpomino
```text
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-run/doc/svnlog7_5_0.txt:134:-NetServer: Single player replay download command will download the Personal Best record if the requested record is not found in the leaderboard.
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-run/doc/svnlog7_5_0.txt:910:BOM removed as requested by xlro (some problems with command line compilation)
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-run/doc/svnlog7_5_0.txt:1352:*netserver.cfg: Modified Rated presets: On request, 15 second default auto-start timer and Reduced garbage tables in all modes
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-run/doc/svnlog7_5_0.txt:1686:+Added "GBCWallkick" wallkick and "NintendoGBC" rule (requested by 2ch; Still has incorrect timing)
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:123:	/** true if server shutdown is requested */
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:124:	private static boolean isShutdownRequested;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:735:			isShutdownRequested = true;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:793:				requestBanFromGUI(commands[1], banLength, false);
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:796:				requestBanFromGUI(commands[1], -1, false);
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:892:	private void requestBanFromGUI(String strIP, int banLength, boolean showMessage) {
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:971:				requestBanFromGUI(txtfldBanIP.getText(),comboboxBanLength.getSelectedIndex() - 1, false);
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:1023:				isShutdownRequested = false;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:1410:		if(isShutdownRequested) {
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/mu/nu/nullpo/tool/netadmin/NetAdmin.java:1557:					requestBanFromGUI(strIP, -1, true);
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-run/doc/svnlog7_4_0.txt:267:Server Status File (number of online users) as requested by Blink
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-run/doc/svnlog7_4_0.txt:2554:   A /trunk/src/mu/nu/nullpo/game/net/NetServerDisconnectRequestedException.java
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-run/doc/svnlog7_4_0.txt:2558:+NetAdmin/NetServer: "shutdown" command will now request self-shutdown to the server.
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/net/tetrisconcept/poochy/nullpomino/ai/PoochyBot.java:47:	public ThinkRequestMutex thinkRequest;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/net/tetrisconcept/poochy/nullpomino/ai/PoochyBot.java:101:		thinkRequest = new ThinkRequestMutex();
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/net/tetrisconcept/poochy/nullpomino/ai/PoochyBot.java:149:			thinkRequest.newRequest();
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/net/tetrisconcept/poochy/nullpomino/ai/PoochyBot.java:164:			thinkRequest.newRequest();
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/net/tetrisconcept/poochy/nullpomino/ai/PoochyBot.java:245:				thinkRequest = true;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/net/tetrisconcept/poochy/nullpomino/ai/PoochyBot.java:267:				thinkRequest.newRequest();
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/net/tetrisconcept/poochy/nullpomino/ai/PoochyBot.java:274:				thinkRequest.newRequest();
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/nullpomino/nullpomino-core/src/main/java/net/tetrisconcept/poochy/nullpomino/ai/PoochyBot.java:286:				thinkRequest.newRequest();
```

### puyoai
```text
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/README.md:157:Issue List に問題を報告、もしくは Pull request を送ってください。
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/third_party/gtest/BUILD.gn:56:#    # http://stackoverflow.com/questions/12558327/google-test-in-visual-studio-2012
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/neural.cc:21:#include "core/frame_request.h"
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/neural.cc:39:vector<NeuralNetResponse> ask_puyo_server(const std::vector<NeuralNetRequest>& request) {
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/neural.cc:49:        for (size_t i = 0; i < request.size(); ++i) {
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/neural.cc:50:            const NeuralNetRequest& req = request[i];
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/mayah_ai_test.cc:8:#include "core/frame_request.h"
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/mayah_ai_test.cc:76:    FrameRequest req;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/mayah_ai_test.cc:127:    FrameRequest req;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/mayah_ai_test.cc:158:    FrameRequest req;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/mayah_ai_test.cc:189:    FrameRequest req;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/mayah_ai_test.cc:222:    FrameRequest req;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/mayah_ai_test.cc:255:    FrameRequest req;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/yamaguchi/main.cc:8:#include "core/frame_request.h"
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/neural.h:10:struct NeuralNetRequest {
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/neural.h:11:    NeuralNetRequest() = default;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/neural.h:12:    NeuralNetRequest(const PlainField& plain_field, const Kumipuyo& next1, const Kumipuyo& next2, int rest_hand) :
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/neural.h:36:std::vector<NeuralNetResponse> ask_puyo_server(const std::vector<NeuralNetRequest>& request);
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/duel/duel_server.cc:222:            manager->connector(pi)->send(gameState.toFrameRequestFor(pi));
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/duel/duel_server.cc:260:    // Send Request for GameResult.
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/duel/duel_server.cc:265:            manager->connector(pi)->send(gameState.toFrameRequestFor(pi));
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/mayah/mayah_base_ai.h:25:    void onGameWillBegin(const FrameRequest&) override;
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/takapt/main.cc:11:#include "core/frame_request.h"
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/takapt/main.cc:331:    void onGameWillBegin(const FrameRequest&) override
/Users/tatsheen/claw-repos/oss-index/puzzle-bench/puyoai/src/cpu/takapt/main.cc:336:    void onDecisionRequestedForMe(const FrameRequest&) override
```

