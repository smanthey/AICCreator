# Roblox OSS Monetization + Setup Seeds

Generated: 2026-03-03T18:19:11Z

## Repo list
- AeroGameFramework
- ByteNet
- Fusion
- Knit
- MockDataStoreService
- NevermoreEngine
- Roblox-Game-Template
- creator-docs
- knit-starter
- rbx-net
- roblox-lua-promise

## Monetization and economy keyword hits

### AeroGameFramework
```text
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/filelist.json:135:                        "name": "MockDataStoreService.lua"
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
/Users/tatsheen/claw-repos/oss-index/roblox/AeroGameFramework/src/ServerStorage/Aero/Modules/Data/MockDataStoreService.lua:207:	return realDataStoreService:GetRequestBudgetForRequestType(requestType)
```

### ByteNet
No keyword hits in first-pass scan.

### Fusion
```text
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
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/assets/theme/admonition.css:36:.md-typeset .question {
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/index.md:36:	- helpful advice to answer your questions and ease your porting process
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/examples/cookbook/fetch-data-from-server.md:128:so the request is sent out automatically.
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/fundamentals/computeds.md:51:occur (e.g. waiting for a server to respond to a request).
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/best-practices/optimisation.md:164:??? question "Why won't Fusion skip those updates?"
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/best-practices/optimisation.md:191:According to the similarity test (and the question section above), one way to
/Users/tatsheen/claw-repos/oss-index/roblox/Fusion/docs/tutorials/get-started/developer-tools.md:27:??? question "Have a new tool for this page?"
```

### Knit
```text
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/README.md:50:A service is simply a structure that _serves_ some specific purpose. For instance, a game might have a MoneyService, which manages in-game currency for players. Let's look at a simple example:
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/README.md:64:	local money = someDataStore:GetAsync("money")
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/README.md:72:	someDataStore:SetAsync("money", money)
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/ARCHIVAL.md:15:As Knit steps away from the Roblox ecosystem, a good question to ask is: What role did Knit serve?
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/intellisense.md:23:Thus, the question at hand is: **How do we get Luau to understand the _type_ of our service?**
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/intellisense.md:102:A fair question to ask is: Why is this not the preferred setup for Knit?
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/gettingstarted.md:51:A service is simply a structure that _serves_ some specific purpose. For instance, a game might have a MoneyService, which manages in-game currency for players. Let's look at a simple example:
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/gettingstarted.md:65:	local money = someDataStore:GetAsync("money")
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/gettingstarted.md:73:	someDataStore:SetAsync("money", money)
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/middleware.md:9:Middleware can be used to both transform inbound/outbound arguments, and also decide to drop requests/responses. This is useful for many use-cases, such as automatically serializing/deserializing complex data types over the network, or sanitizing incoming data.
/Users/tatsheen/claw-repos/oss-index/roblox/Knit/docs/middleware.md:17:Each function should return a boolean, indicating whether or not to continue to the request/response. If `false`, an optional variadic list of items can be returned, which will be returned back to the caller (essentially a short-circuit, but still returning data).
```

### MockDataStoreService
```text
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:3:local MockDataStoreService_Module = script.Parent.Parent.Parent.DataStoreService.MockDataStoreService
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:5:Test.Service = require(MockDataStoreService_Module)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:6:Test.Constants = require(MockDataStoreService_Module.MockDataStoreConstants)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:7:Test.Manager = require(MockDataStoreService_Module.MockDataStoreManager)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:8:Test.Utils = require(MockDataStoreService_Module.MockDataStoreUtils)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:9:Test.Pages = require(MockDataStoreService_Module.MockDataStorePages)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:49:        for _,v in pairs(Enum.DataStoreRequestType:GetEnumItems()) do
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:54:        for requestType, budget in pairs(budgets) do
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:55:            Test.Manager.SetBudget(requestType, budget)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:61:    for _,v in pairs(Enum.DataStoreRequestType:GetEnumItems()) do
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:62:        if v ~= Enum.DataStoreRequestType.UpdateAsync then
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:70:    for requestType, difference in pairs(checkpoint) do
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:71:        if Test.Manager.GetBudget(requestType) - capturedBudgets[requestType] ~= difference then
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:75:        capturedBudgets[requestType] = nil
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:78:        for requestType, budget in pairs(capturedBudgets) do
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/spec/MockDataStoreService/Test.lua:79:            if Test.Manager.GetBudget(requestType) ~= budget then
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/default.project.json:2:  "name": "DataStoreService",
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/MockDataStoreService/MockOrderedDataStore.lua:2:	MockOrderedDataStore.lua
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/MockDataStoreService/MockOrderedDataStore.lua:3:	This module implements the API and functionality of Roblox's OrderedDataStore class.
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/MockDataStoreService/MockOrderedDataStore.lua:6:	https://github.com/buildthomas/MockDataStoreService/blob/master/LICENSE
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/MockDataStoreService/MockOrderedDataStore.lua:9:local MockOrderedDataStore = {}
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/MockDataStoreService/MockOrderedDataStore.lua:10:MockOrderedDataStore.__index = MockOrderedDataStore
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/MockDataStoreService/MockOrderedDataStore.lua:12:local MockDataStoreManager = require(script.Parent.MockDataStoreManager)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/MockDataStoreService/MockOrderedDataStore.lua:13:local MockDataStorePages = require(script.Parent.MockDataStorePages)
/Users/tatsheen/claw-repos/oss-index/roblox/MockDataStoreService/lib/MockDataStoreService/MockOrderedDataStore.lua:14:local Utils = require(script.Parent.MockDataStoreUtils)
```

### NevermoreEngine
```text
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/timedtween/CHANGELOG.md:608:- users/quenty/datastore [#402](https://github.com/Quenty/NevermoreEngine/pull/402) ([@Quenty](https://github.com/Quenty))
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/rbxthumb/src/Shared/RbxThumbnailTypes.lua:18:	| "GamePass"
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/rbxthumb/src/Shared/RbxThumbnailTypes.lua:29:	GAME_PASS = "GamePass" :: "GamePass",
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/rbxthumb/src/Shared/RbxThumbUtils.lua:21:	| "GamePass"
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/rbxthumb/src/Shared/RbxThumbUtils.lua:40:	"GamePass"          150x150
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/rbxthumb/src/Shared/RbxThumbUtils.lua:194:	Gets a GamePass URL for use in an image label or other rendering application.
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/rbxthumb/src/Shared/RbxThumbUtils.lua:203:function RbxThumbUtils.getGamePassThumbnailUrl(targetId: number, width: number?, height: number?): string
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/ducktype/CHANGELOG.md:282:- Fix DataStore.lua documentation type [#372](https://github.com/Quenty/NevermoreEngine/pull/372) ([@max-bacon](https://github.com/max-bacon))
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/remoting/src/Shared/Interface/Remoting.lua:393:	Fires the client with the individual request. Should consider this syntax instead.
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/geometryutils/src/Shared/CircleUtils.lua:9:	https://math.stackexchange.com/questions/110080/shortest-way-to-achieve-target-angle
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Client/GameConfigServiceClient.lua:22:	self._serviceBag:GetService(require("MarketplaceServiceCache"))
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Shared/Config/Asset/GameConfigAssetUtils.lua:12:local MarketplaceServiceCache = require("MarketplaceServiceCache")
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Shared/Config/Asset/GameConfigAssetUtils.lua:59:	local marketplaceServiceCache = serviceBag:GetService(MarketplaceServiceCache)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Shared/Config/Asset/GameConfigAssetUtils.lua:65:		return marketplaceServiceCache:PromiseProductInfo(assetId, Enum.InfoType.Product)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Shared/Config/Asset/GameConfigAssetUtils.lua:67:		return marketplaceServiceCache:PromiseProductInfo(assetId, Enum.InfoType.GamePass)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Shared/Config/Asset/GameConfigAssetUtils.lua:69:		return marketplaceServiceCache:PromiseProductInfo(assetId, Enum.InfoType.Asset)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Shared/Config/Asset/GameConfigAssetUtils.lua:71:		return marketplaceServiceCache:PromiseProductInfo(assetId, Enum.InfoType.Asset)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Shared/Config/Asset/GameConfigAssetUtils.lua:73:		return marketplaceServiceCache:PromiseProductInfo(assetId, Enum.InfoType.Bundle)
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/src/gameconfig/src/Server/GameConfigService.lua:45:	self._serviceBag:GetService(require("MarketplaceServiceCache"))
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:53:* [DataStore](https://quenty.github.io/NevermoreEngine/api/DataStore) - Battle-tested datastore wrapper
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:72:| [Aggregator](https://quenty.github.io/NevermoreEngine/api/AggregatorUtils) | Aggregates async promise requests | `npm i @quenty/aggregator` | [docs](https://quenty.github.io/NevermoreEngine/api/AggregatorUtils) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/aggregator) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/aggregator/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/aggregator) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:90:| [BodyColorsUtils](https://quenty.github.io/NevermoreEngine/api/BodyColorsDataUtils) | Body color helper utilities for merging and representing body colors over the network and datastore | `npm i @quenty/bodycolorsutils` | [docs](https://quenty.github.io/NevermoreEngine/api/BodyColorsDataUtils) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/bodycolorsutils) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/bodycolorsutils/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/bodycolorsutils) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:125:| [DataStore](https://quenty.github.io/NevermoreEngine/api/DataStore) | Quenty's Datastore implementation for Roblox | `npm i @quenty/datastore` | [docs](https://quenty.github.io/NevermoreEngine/api/DataStore) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/datastore) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/datastore/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/datastore) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:138:| [ExperienceCalculator](https://quenty.github.io/NevermoreEngine/api/ExperienceUtils) | Calculate experience on an exponential curve and perform relevant calculations Uses formulas from stackoverflow.com/questions/6954874/php-game-formula-to-calculate-a-level-based-on-exp | `npm i @quenty/experiencecalculator` | [docs](https://quenty.github.io/NevermoreEngine/api/ExperienceUtils) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/experiencecalculator) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/experiencecalculator/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/experiencecalculator) |
/Users/tatsheen/claw-repos/oss-index/roblox/NevermoreEngine/readme.md:163:| [HttpPromise](https://quenty.github.io/NevermoreEngine/api/HttpPromise) | HttpPromise - Wrapper functions around http requests in Roblox. | `npm i @quenty/httppromise` | [docs](https://quenty.github.io/NevermoreEngine/api/HttpPromise) | [source](https://github.com/Quenty/NevermoreEngine/tree/main/src/httppromise) | [changelog](https://github.com/Quenty/NevermoreEngine/tree/main/src/httppromise/CHANGELOG.md) | [npm](https://www.npmjs.com/package/@quenty/httppromise) |
```

### Roblox-Game-Template
```text
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/client/Controllers/Guis/CurrencyController.lua:10:local Gui = GuiController.Guis.Currency
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/README.md:71:- Currency labels UI created and hooked into the State.
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/README.md:73:- Utilize the AdjustBalance command from Cmdr to adjust a player's currency amount.
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Services/PlayerDataService.lua:12:local DATASTORE_NAME = "Production"
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Services/PlayerDataService.lua:15:    DATASTORE_NAME = "Development"
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Services/PlayerDataService.lua:27:Local.ProfileStore = ProfileStore.GetProfileStore(DATASTORE_NAME, PlayerData)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/client/Controllers/GuiController.lua:10:    Currency = PlayerGui:WaitForChild("Currency"),
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/shared/Configs/PlayerData.lua:1:export type Currency = "coins" | "gems"
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Commands/AdjustBalanceServer.lua:7:return function (context, currency: PlayerData.Currency, amount: number, player: Player?)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Commands/AdjustBalanceServer.lua:9:    Store.updateBalance(tostring(player.UserId), currency, amount)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Types/Currency.lua:7:for currency, _ in PlayerData.balance do
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Types/Currency.lua:8:	table.insert(currencies, currency)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Types/Currency.lua:12:	registry:RegisterType("currency", registry.Cmdr.Util.MakeEnumType("currency", currencies))
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/shared/Store/Slices/Players/Balance.lua:17:    updateBalance: (playerId: string, currency: PlayerData.Currency, amount: number) -> (),
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/shared/Store/Slices/Players/Balance.lua:31:    updateBalance = function(state, playerId: string, currency: PlayerData.Currency, amount: number)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/shared/Store/Slices/Players/Balance.lua:37:            return Sift.Dictionary.set(balance, currency, balance[currency] + amount)
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Commands/AdjustBalance.lua:8:			Type = "currency";
/Users/tatsheen/claw-repos/oss-index/roblox/Roblox-Game-Template/src/server/Cmdr/Commands/AdjustBalance.lua:9:			Name = "Currency";
```

### creator-docs
```text
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CONTRIBUTING.md:21:For instructions on keeping your fork in sync with `Roblox/creator-docs` over time, see [Syncing a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork).
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CONTRIBUTING.md:47:## Opening Pull Requests
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CONTRIBUTING.md:59:Then open [`Roblox/creator-docs`](https://github.com/Roblox/creator-docs/pulls) on GitHub and click **New Pull Request**. Choose **main** as the _base_ branch and your branch as the _compare_ branch.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/CONTRIBUTING.md:61:Add a title and description of your changes, confirm that the contribution is your own, original work that you have the right to submit, and create the pull request.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/package.json:26:    "markdownlint": "markdownlint-cli2 '**/*.{md,mdx}' '#**/node_modules/**' '#.github/pull_request_template.md' --config='.markdownlint.json' --fix",
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:7:If you're unfamiliar with the GitHub contribution process, see [About pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests) and the following video.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:13:If you find a problem with the documentation and don't want to submit a pull request, please let us know by [reporting it on the Roblox developer forums](https://devforum.roblox.com/w/bug-report/).
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:21:When you submit a pull request for review, you must agree to the following:
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:35:1. Ensure that the base repository is `Roblox/creator-docs` and the base branch is `main`. Verify that you're happy with your changes and click **Create pull request**.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:36:1. Finally, fill out the details in the pull request description and click **Create pull request**.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:50:1. Click **Compare & pull request**.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:52:1. Finally, fill out the details in the pull request description and click **Create pull request**.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:54:Alternatively, you can use the **GitHub** or **GitHub Pull Request** menus in github.dev to submit the pull request. For documentation on using github.dev, see [GitHub Codespaces](https://docs.github.com/en/codespaces/the-githubdev-web-based-editor).
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:66:1. Commit, push to your fork, and submit your pull request against this repository's `main` branch.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:86:  We provide these files so that you can view the source and use them in your own projects, but we **no longer** accept pull requests on the reference `.yaml` files.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/README.md:92:Try to limit your edits to one class or feature so that the pull request is easier to review. Bug fixes and smaller improvements have a higher likelihood of fast approval. Large guides often require significant back-and-forth before publication.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/LICENSE:48:     rights in the material. A licensor may make special requests,
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/LICENSE:51:     respect those requests where reasonable. More considerations
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/LICENSE:225:                    attribution, in any reasonable manner requested by
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/LICENSE:253:       3. If requested by the Licensor, You must remove any of the
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/content/en-us/creator-programs/creator-events.md:51:If you have any questions or concerns about this program, please reach out to any [program staff](https://devforum.roblox.com/g/Events_Staff) on the DevForum. Alternatively, you can email us at dev-events@roblox.com.
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/package-lock.json:3139:        "@octokit/request": "^8.4.1",
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/package-lock.json:3140:        "@octokit/request-error": "^5.1.1",
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/package-lock.json:3204:        "@octokit/request": "^8.4.1",
/Users/tatsheen/claw-repos/oss-index/roblox/creator-docs/package-lock.json:3269:    "node_modules/@octokit/plugin-request-log": {
```

### knit-starter
```text
/Users/tatsheen/claw-repos/oss-index/roblox/knit-starter/README.md:27:    As of writing this Imo the best way to handle Datastores as it 
```

### rbx-net
```text
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/client/ClientAsyncFunction.ts:148:				reject("Request to server timed out after " + this.timeout + " seconds");
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/server/ServerAsyncFunction.ts:180:				reject("Request to client timed out");
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/luau/dist/init.lua:46:	MaxRequestsPerMinute: number,
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/luau/dist/init.lua:50:	MaxRequestsPerMinute: number,
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/ratelimit.md:15:## Limiting to a certain amount of requests
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/ratelimit.md:24:    MaxRequestsPerMinute: 1 // This can be the amount of requests you want to limit per minute
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/ratelimit.md:32:    MaxRequestsPerMinute = 1 -- This can be the amount of requests you want to limit per minute
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/ratelimit.md:47:            MaxRequestsPerMinute: 1
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/ratelimit.md:60:            MaxRequestsPerMinute = 1
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/ratelimit.md:94:            MaxRequestsPerMinute: 1,
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/ratelimit.md:114:            MaxRequestsPerMinute = 1,
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/src/internal/index.ts:15:export interface RequestCounter {
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/api/net-middleware.md:24:	MaxRequestsPerMinute: number;
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/api/net-middleware.md:27:    MaxRequestsPerMinute: number;
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/versioned_docs/version-1.3.0/throttling.md:9:When using remotes in Roblox, you might want to limit the amount of times a user can send a request to a remote event or remote function.
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/versioned_docs/version-1.3.0/throttling.md:46:What the above does, is it creates a server function and then sets a limit of 1 request per minute.
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/versioned_docs/version-1.3.0/doc1.md:33:- Throttling - RemoteFunctions and RemoteEvents can be set to throttle requests.
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/versioned_docs/version-2.0.x/api/net-middleware.md:24:	MaxRequestsPerMinute: number;
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/versioned_docs/version-2.0.x/api/net-middleware.md:27:    MaxRequestsPerMinute: number;
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/versioned_docs/version-1.3.0/caching.md:9:Functions in RbxNet can be set to cache the return value. This means any subsequent requests to the function will return a local value rather than continually request the value from the server.
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/custom.md:75:        // Otherwise the remote request is ignored
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/custom.md:93:		-- Otherwise the remote request is ignored since the next middleware is never called
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/docs/middleware/custom.md:105:The above middleware, when applied to a remote will only continue and call the callback/listener _if_ the `next`/`nextMiddleware` callbacks are called. Otherwise RbxNet will drop these requests.
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/versioned_docs/version-2.0.x/install-lua.md:38:Invoke-WebRequest -UseBasicParsing vorlias.com/rbx-net.ps1 | Invoke-Expression
/Users/tatsheen/claw-repos/oss-index/roblox/rbx-net/docs/versioned_docs/version-2.0.x/middleware/ratelimit.md:15:## Limiting to a certain amount of requests
```

### roblox-lua-promise
```text
/Users/tatsheen/claw-repos/oss-index/roblox/roblox-lua-promise/docs/WhyUsePromises.md:13:But sometimes situations arise where we call a function that needs access to a value that *doesn't* exist at call time. This could be because it requires a network request to get the data, or the user needs to input some text, or we're waiting for another process to finish computation and give us the value. In any case, we refer to this as an "asynchronous operation".
/Users/tatsheen/claw-repos/oss-index/roblox/roblox-lua-promise/docs/WhyUsePromises.md:25:So, what really happens when we call an asynchronous function like `Player:IsInGroup`? Well, the current Lua thread yields (letting other Lua code start running elsewhere in your game), and Roblox makes a new OS thread which blocks on an HTTP request to their internal group APIs in the background. Sometime in the future when that request comes back, the value jumps back onto the main Roblox thread and your Lua thread is scheduled to be resumed with the given arguments on the next step.
```

