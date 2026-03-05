# Repo Map: NevermoreEngine


# generated repo map
```
└── NevermoreEngine
    ├── Images
    │   ├── NevermoreLogo.png
    │   ├── NevermoreLogo.svg
    │   ├── NevermoreLogo_32x32.png
    │   └── NevermoreLogo_Simple.png
    ├── docs
    │   ├── architecture
    │   │   ├── design.md
    │   │   ├── index.md
    │   │   ├── patterns.md
    │   │   └── servicebag.md
    │   ├── conventions
    │   │   ├── git-workflow.md
    │   │   ├── index.md
    │   │   ├── luau.md
    │   │   ├── templates.md
    │   │   └── typescript.md
    │   ├── gotchas
    │   │   ├── index.md
    │   │   ├── tooling.md
    │   │   └── troubleshooting.md
    │   ├── ides
    │   │   ├── index.md
    │   │   └── vscode.md
    │   ├── testing
    │   │   ├── index.md
    │   │   ├── integration-testing.md
    │   │   └── testing.md
    │   ├── _AI_INDEX.md
    │   ├── install.md
    │   └── intro.md
    ├── games
    │   └── integration
    │       ├── modules
    │       │   ├── Client
    │       │   │   ├── Button
    │       │   │   │   ├── LookAtButtonsClient.lua
    │       │   │   │   └── PhysicalButtonClient.lua
    │       │   │   ├── GameBindersClient.lua
    │       │   │   └── GameServiceClient.lua
    │       │   ├── Server
    │       │   │   ├── Button
    │       │   │   │   ├── LookAtButtons.lua
    │       │   │   │   └── PhysicalButton.lua
    │       │   │   ├── GameBindersServer.lua
    │       │   │   └── GameServiceServer.lua
    │       │   └── Shared
    │       │       ├── Button
    │       │       │   └── PhysicalButtonConstants.lua
    │       │       └── GameTranslator.lua
    │       ├── places
    │       │   └── NevermoreIntegrationTest.rbxl
    │       ├── scripts
    │       │   ├── Client
    │       │   │   └── ClientMain.client.lua
    │       │   └── Server
    │       │       └── ServerMain.server.lua
    │       ├── README.md
    │       ├── aftman.toml
    │       ├── default.project.json
    │       ├── deploy.nevermore.json
    │       └── package.json
    ├── plugins
    │   ├── preview-plugin
    │   │   ├── src
    │   │   │   ├── modules
    │   │   │   │   └── Server
    │   │   │   │       └── PreviewFinder.lua
    │   │   │   └── init.server.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   └── ui-converter-plugin
    │       ├── src
    │       │   ├── modules
    │       │   │   └── Server
    │       │   │       ├── ConverterPane.lua
    │       │   │       ├── ConverterPane.story.lua
    │       │   │       ├── RxUIConverterUtils.lua
    │       │   │       ├── UIConverter.lua
    │       │   │       ├── UIConverterNeverSkipProps.lua
    │       │   │       └── UIConverterUtils.lua
    │       │   └── init.server.lua
    │       ├── test
    │       │   └── default.project.json
    │       ├── README.md
    │       ├── default.project.json
    │       └── package.json
    ├── src
    │   ├── acceltween
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── AccelTween.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── accessorytypeutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── AccessoryTypeUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── actionmanager
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── ActionManager.lua
    │   │   │       └── BaseAction.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── adorneeboundingbox
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── AdorneeBoundingBox.lua
    │   │   │       ├── AdorneeBoundingBox.story.lua
    │   │   │       ├── AdorneeModelBoundingBox.lua
    │   │   │       ├── AdorneePartBoundingBox.lua
    │   │   │       └── RxPartBoundingBoxUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── adorneedata
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── AdorneeData.lua
    │   │   │       ├── AdorneeDataEntry.lua
    │   │   │       └── AdorneeDataValue.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── adorneeutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── AdorneeUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── adorneevalue
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── AdorneeValue.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── aggregator
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Aggregator.lua
    │   │   │       └── RateAggregator.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── animationgroup
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── AnimationGroup.lua
    │   │   │       └── AnimationGroupUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── animationprovider
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── AnimationProvider.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── animations
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Testing
    │   │   │   │   │   └── StudioRigAnimator.lua
    │   │   │   │   ├── AnimationPromiseUtils.lua
    │   │   │   │   ├── AnimationSlotPlayer.lua
    │   │   │   │   ├── AnimationTrackPlayer.lua
    │   │   │   │   ├── AnimationUtils.lua
    │   │   │   │   └── AnimationUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── animationtrackutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── AnimationTrackUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── applytagtotaggedchildren
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── ApplyTagToTaggedChildren.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── assetserviceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── AssetServiceCache.lua
    │   │   │       └── AssetServiceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── attributeutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── AttributeUtils.lua
    │   │   │       ├── AttributeValue.lua
    │   │   │       ├── EncodedAttributeValue.lua
    │   │   │       ├── JSONAttributeValue.lua
    │   │   │       └── RxAttributeUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── avatareditorutils
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── AvatarEditorInventory.lua
    │   │   │   │   └── AvatarEditorInventoryServiceClient.lua
    │   │   │   └── Shared
    │   │   │       ├── Cache
    │   │   │       │   └── CatalogSearchServiceCache.lua
    │   │   │       └── AvatarEditorUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── axisangleutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── AxisAngleUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── badgeutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── BadgeUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── baseobject
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── BaseObject.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── basicpane
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── BasicPane.lua
    │   │   │       └── BasicPaneUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── bezierutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── BezierUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── binarysearch
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── BinarySearchUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── binder
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Collection
    │   │   │   │   │   └── BoundChildCollection.lua
    │   │   │   │   ├── Promise
    │   │   │   │   │   └── promiseBoundClass.lua
    │   │   │   │   ├── Trackers
    │   │   │   │   │   ├── BoundAncestorTracker.lua
    │   │   │   │   │   └── BoundParentTracker.lua
    │   │   │   │   ├── Binder.lua
    │   │   │   │   ├── BinderGroup.lua
    │   │   │   │   ├── BinderGroupProvider.lua
    │   │   │   │   ├── BinderProvider.lua
    │   │   │   │   ├── BinderProvider.spec.lua
    │   │   │   │   └── BinderUtils.lua
    │   │   │   └── jest.config.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── bindtocloseservice
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       └── BindToCloseService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── blend
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Blend
    │   │   │   │   │   ├── Blend.lua
    │   │   │   │   │   ├── BlendDefaultProps.lua
    │   │   │   │   │   ├── BlendDefaultProps.spec.lua
    │   │   │   │   │   └── SpringObject.lua
    │   │   │   │   └── Test
    │   │   │   │       ├── BlendChildren.story.lua
    │   │   │   │       ├── BlendComputePairs.story.lua
    │   │   │   │       ├── BlendFind.story.lua
    │   │   │   │       ├── BlendPromise.story.lua
    │   │   │   │       ├── BlendSingle.story.lua
    │   │   │   │       ├── BlendSpring.story.lua
    │   │   │   │       └── BlendTextbox.story.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── bodycolorsutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── BodyColorsDataConstants.lua
    │   │   │       ├── BodyColorsDataUtils.lua
    │   │   │       └── RxBodyColorsDataUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── boundingboxutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── BoundingBoxUtils.lua
    │   │   │       └── CompiledBoundingBoxUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── boundlinkutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── BoundLinkCollection.lua
    │   │   │       ├── BoundLinkUtils.lua
    │   │   │       └── promiseBoundLinkedClass.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── brio
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Brio.lua
    │   │   │   │   ├── BrioUtils.lua
    │   │   │   │   ├── BrioUtils.spec.lua
    │   │   │   │   ├── RxBrioUtils.lua
    │   │   │   │   └── RxBrioUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── buttondragmodel
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── ButtonDragModel.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── buttonhighlightmodel
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── ButtonHighlightModel.lua
    │   │   │       └── HandleHighlightModel.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── buttonutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── ButtonUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── camera
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Controls
    │   │   │   │   │   ├── CameraControls.lua
    │   │   │   │   │   ├── CameraGamepadInputUtils.lua
    │   │   │   │   │   └── GamepadRotateModel.lua
    │   │   │   │   ├── Effects
    │   │   │   │   │   ├── FadeBetween
    │   │   │   │   │   │   ├── FadeBetweenCamera.lua
    │   │   │   │   │   │   ├── FadeBetweenCamera2.lua
    │   │   │   │   │   │   ├── FadeBetweenCamera3.lua
    │   │   │   │   │   │   └── FadeBetweenCamera4.lua
    │   │   │   │   │   ├── CameraEffectUtils.lua
    │   │   │   │   │   ├── CustomCameraEffect.lua
    │   │   │   │   │   ├── DefaultCamera.lua
    │   │   │   │   │   ├── FadingCamera.lua
    │   │   │   │   │   ├── HeartbeatCamera.lua
    │   │   │   │   │   ├── ImpulseCamera.lua
    │   │   │   │   │   ├── ImpulseCamera.story.lua
    │   │   │   │   │   ├── InverseFader.lua
    │   │   │   │   │   ├── LagPointCamera.lua
    │   │   │   │   │   ├── OverrideDefaultCameraToo.lua
    │   │   │   │   │   ├── PointCamera.lua
    │   │   │   │   │   ├── PushCamera.lua
    │   │   │   │   │   ├── README.md
    │   │   │   │   │   ├── RotatedCamera.lua
    │   │   │   │   │   ├── SmoothPositionCamera.lua
    │   │   │   │   │   ├── SmoothRotatedCamera.lua
    │   │   │   │   │   ├── SmoothZoomedCamera.lua
    │   │   │   │   │   ├── SummedCamera.lua
    │   │   │   │   │   ├── TrackCamera.lua
    │   │   │   │   │   ├── XZPlaneLockCamera.lua
    │   │   │   │   │   └── ZoomedCamera.lua
    │   │   │   │   ├── Input
    │   │   │   │   │   ├── CameraInputUtils.lua
    │   │   │   │   │   └── CameraTouchInputUtils.lua
    │   │   │   │   ├── Utility
    │   │   │   │   │   ├── CameraFrame.lua
    │   │   │   │   │   ├── CameraFrame.story.lua
    │   │   │   │   │   ├── CameraStateTweener.lua
    │   │   │   │   │   ├── CameraSubjectUtils.lua
    │   │   │   │   │   └── FieldOfViewUtils.lua
    │   │   │   │   ├── CameraStack.lua
    │   │   │   │   ├── CameraStackService.lua
    │   │   │   │   ├── CameraState.lua
    │   │   │   │   ├── CameraUtils.lua
    │   │   │   │   └── CameraUtils.story.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── camerainfo
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── CameraInfoUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── camerastoryutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── CameraStoryUtils.lua
    │   │   │       └── RenderCrateUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── cancellabledelay
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── cancellableDelay.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── canceltoken
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── CancelToken.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── cframeserializer
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── CFrameSerializer.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── cframeutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── CFrameUtils.lua
    │   │   │       └── getRotationInXZPlane.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── characterparticleplayer
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── ParticlePlayer.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── characterutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── CharacterPromiseUtils.lua
    │   │   │       ├── CharacterUtils.lua
    │   │   │       ├── RootPartUtils.lua
    │   │   │       ├── RxCharacterUtils.lua
    │   │   │       └── RxRootPartUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── chatproviderservice
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Binders
    │   │   │   │   │   ├── ChatTagClient.lua
    │   │   │   │   │   └── HasChatTagsClient.lua
    │   │   │   │   ├── Commands
    │   │   │   │   │   └── ChatProviderCommandServiceClient.lua
    │   │   │   │   └── ChatProviderServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Binders
    │   │   │   │   │   ├── ChatTag.lua
    │   │   │   │   │   └── HasChatTags.lua
    │   │   │   │   ├── Commands
    │   │   │   │   │   └── ChatProviderCommandService.lua
    │   │   │   │   └── ChatProviderService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── Binders
    │   │   │   │   │   ├── ChatTagBase.lua
    │   │   │   │   │   └── HasChatTagsBase.lua
    │   │   │   │   ├── Commands
    │   │   │   │   │   └── ChatTagCmdrUtils.lua
    │   │   │   │   ├── Data
    │   │   │   │   │   ├── ChatTagDataUtils.lua
    │   │   │   │   │   └── ChatTagDataUtils.spec.lua
    │   │   │   │   ├── ChatProviderTags.rbxmx
    │   │   │   │   ├── ChatProviderTranslator.lua
    │   │   │   │   ├── ChatTagConstants.lua
    │   │   │   │   ├── HasChatTagsConstants.lua
    │   │   │   │   └── TextChannelUtils.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── clienttranslator
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Conversion
    │   │   │   │   │   └── LocalizationEntryParserUtils.lua
    │   │   │   │   ├── Numbers
    │   │   │   │   │   ├── NumberLocalizationUtils.lua
    │   │   │   │   │   ├── NumberLocalizationUtils.spec.lua
    │   │   │   │   │   └── RoundingBehaviourTypes.lua
    │   │   │   │   ├── Utils
    │   │   │   │   │   ├── LocalizationServiceUtils.lua
    │   │   │   │   │   └── TranslationKeyUtils.lua
    │   │   │   │   ├── JSONTranslator.lua
    │   │   │   │   └── TranslatorService.lua
    │   │   │   └── jest.config.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── clipcharacters
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── ClipCharacters.lua
    │   │   │   │   └── ClipCharactersServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   └── ClipCharactersService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── ClipCharactersServiceConstants.lua
    │   │   │   │   └── ClipCharactersServiceConstants.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── cmdrservice
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   └── CmdrServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── CmdrTemplateProviderServer
    │   │   │   │   │   ├── CmdrCommandDefinitionTemplate.lua
    │   │   │   │   │   ├── CmdrExecutionTemplate.lua
    │   │   │   │   │   └── init.lua
    │   │   │   │   └── CmdrService.lua
    │   │   │   ├── Shared
    │   │   │   │   └── CmdrTypes.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── collectionserviceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── CollectionServiceUtils.lua
    │   │   │       └── RxCollectionServiceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── color3serializationutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Color3SerializationUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── color3utils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── luv
    │   │   │       │   ├── LuvColor3Utils.lua
    │   │   │       │   ├── LuvColor3Utils.story.lua
    │   │   │       │   ├── LuvUtils.lua
    │   │   │       │   └── LuvVectorColor3Utils.lua
    │   │   │       └── Color3Utils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── colorpalette
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Font
    │   │   │       │   └── FontPalette.lua
    │   │   │       ├── Grade
    │   │   │       │   ├── ColorGradePalette.lua
    │   │   │       │   ├── ColorGradePalette.story.lua
    │   │   │       │   └── ColorGradeUtils.lua
    │   │   │       ├── Swatch
    │   │   │       │   ├── ColorSwatch.lua
    │   │   │       │   └── ColorSwatch.story.lua
    │   │   │       ├── ColorPalette.lua
    │   │   │       └── ColorPalette.story.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── colorpicker
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── Cursor
    │   │   │       │   ├── ColorPickerCursorPreview.lua
    │   │   │       │   ├── ColorPickerTriangle.lua
    │   │   │       │   └── HSColorPickerCursor.lua
    │   │   │       ├── HSV
    │   │   │       │   ├── HSColorPicker.lua
    │   │   │       │   ├── HSColorPicker.story.lua
    │   │   │       │   ├── HSVColorPicker.lua
    │   │   │       │   ├── HSVColorPicker.story.lua
    │   │   │       │   ├── ValueColorPicker.lua
    │   │   │       │   └── ValueColorPicker.story.lua
    │   │   │       ├── Story
    │   │   │       │   └── ColorPickerStoryUtils.lua
    │   │   │       └── ColorPickerUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── colorsequenceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── ColorSequenceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── conditions
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   └── AdorneeConditionUtils.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── contentproviderutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── ContentProviderUtils.lua
    │   │   │       └── ImageLabelLoaded.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── convexhull
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── ConvexHull2DUtils.lua
    │   │   │       ├── ConvexHull3DUtils.lua
    │   │   │       └── ConvexHull3DUtils.story.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── cooldown
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Binders
    │   │   │   │   │   └── CooldownClient.lua
    │   │   │   │   └── CooldownServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Binders
    │   │   │   │   │   └── Cooldown.lua
    │   │   │   │   └── CooldownService.lua
    │   │   │   └── Shared
    │   │   │       ├── Binders
    │   │   │       │   ├── CooldownBase.lua
    │   │   │       │   └── CooldownShared.lua
    │   │   │       ├── Model
    │   │   │       │   ├── CooldownModel.lua
    │   │   │       │   └── CooldownTrackerModel.lua
    │   │   │       ├── Tracker
    │   │   │       │   └── CooldownTracker.lua
    │   │   │       ├── CooldownConstants.lua
    │   │   │       ├── CooldownUtils.lua
    │   │   │       └── RxCooldownUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── coreguienabler
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── CoreGuiEnabler.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── coreguiutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── CoreGuiUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── countdowntext
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── CountdownTextUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── counter
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Counter.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── cubicspline
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── CubicSplineUtils.lua
    │   │   │       └── CubicTweenUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── datastore
    │   │   ├── src
    │   │   │   ├── Server
    │   │   │   │   ├── Modules
    │   │   │   │   │   ├── DataStoreDeleteToken.lua
    │   │   │   │   │   ├── DataStoreSnapshotUtils.lua
    │   │   │   │   │   ├── DataStoreStage.lua
    │   │   │   │   │   └── DataStoreWriter.lua
    │   │   │   │   ├── Utility
    │   │   │   │   │   └── DataStorePromises.lua
    │   │   │   │   ├── DataStore.lua
    │   │   │   │   ├── DataStoreLockHelper.lua
    │   │   │   │   ├── DataStoreMessageHelper.lua
    │   │   │   │   ├── GameDataStoreService.lua
    │   │   │   │   ├── PlayerDataStoreManager.lua
    │   │   │   │   ├── PlayerDataStoreService.lua
    │   │   │   │   └── PrivateServerDataStoreService.lua
    │   │   │   ├── Shared
    │   │   │   │   └── Utility
    │   │   │   │       ├── DataStoreStringUtils.lua
    │   │   │   │       └── DataStoreStringUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── deathreport
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Stats
    │   │   │   │   │   ├── PlayerDeathTrackerClient.lua
    │   │   │   │   │   ├── PlayerKillTrackerClient.lua
    │   │   │   │   │   └── TeamKillTrackerClient.lua
    │   │   │   │   ├── DeathReportBindersClient.lua
    │   │   │   │   └── DeathReportServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Stats
    │   │   │   │   │   ├── PlayerDeathTracker.lua
    │   │   │   │   │   ├── PlayerKillTracker.lua
    │   │   │   │   │   ├── PlayerKillTrackerAssigner.lua
    │   │   │   │   │   └── TeamKillTracker.lua
    │   │   │   │   ├── DeathReportBindersServer.lua
    │   │   │   │   ├── DeathReportService.lua
    │   │   │   │   └── DeathTrackedHumanoid.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── Stats
    │   │   │   │   │   ├── PlayerKillTrackerUtils.lua
    │   │   │   │   │   └── TeamKillTrackerUtils.lua
    │   │   │   │   ├── DeathReportProcessor.lua
    │   │   │   │   ├── DeathReportServiceConstants.lua
    │   │   │   │   ├── DeathReportUtils.lua
    │   │   │   │   └── DeathReportUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── debounce
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── DebounceTimer.lua
    │   │   │       └── debounce.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── defaultvalueutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── DefaultValueUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── deferred
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── deferred.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── depthoffield
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── DepthOfFieldEffect.lua
    │   │   │       └── DepthOfFieldEffect.story.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── draw
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Draw.lua
    │   │   │       ├── DrawBlockcast.story.lua
    │   │   │       ├── DrawRay.story.lua
    │   │   │       └── DrawSpherecast.story.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── ducktype
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── DuckTypeUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── ellipticcurvecryptography
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   └── EllipticCurveCryptography
    │   │   │   │       ├── arith.lua
    │   │   │   │       ├── benchmark.spec.lua
    │   │   │   │       ├── chacha20.lua
    │   │   │   │       ├── curve.lua
    │   │   │   │       ├── init.lua
    │   │   │   │       ├── modp.lua
    │   │   │   │       ├── modq.lua
    │   │   │   │       ├── random.lua
    │   │   │   │       ├── sha256.lua
    │   │   │   │       ├── testing.spec.lua
    │   │   │   │       ├── twoPower.lua
    │   │   │   │       └── util.lua
    │   │   │   └── jest.config.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── elo
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── EloMatchResult.lua
    │   │   │   │   ├── EloMatchResultUtils.lua
    │   │   │   │   ├── EloUtils.lua
    │   │   │   │   ├── EloUtils.spec.lua
    │   │   │   │   └── EloUtils.story.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── enabledmixin
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── EnabledMixin.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── enums
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── SimpleEnum.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── enumutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── EnumUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── equippedtracker
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── EquippedTracker.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── experiencecalculator
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── ExperienceUtils.lua
    │   │   │   │   └── ExperienceUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── fakeskybox
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── FakeSkybox.lua
    │   │   │       └── FakeSkyboxSide.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── firstpersoncharactertransparency
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── HideHead.lua
    │   │   │       └── ShowBody.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── flipbook
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── Library
    │   │   │       │   └── FlipbookLibrary.lua
    │   │   │       ├── Player
    │   │   │       │   ├── FlipbookPlayer.lua
    │   │   │       │   └── FlipbookPlayer.story.lua
    │   │   │       └── Flipbook.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── friendutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── FriendUtils.lua
    │   │   │       └── RxFriendUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── functionutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── FunctionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── funnels
    │   │   ├── src
    │   │   │   ├── Server
    │   │   │   │   └── Steps
    │   │   │   │       └── FunnelStepLogger.lua
    │   │   │   └── Shared
    │   │   │       └── Steps
    │   │   │           └── FunnelStepTracker.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── fzy
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Fzy.lua
    │   │   │   │   └── Fzy.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── gameconfig
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Cmdr
    │   │   │   │   │   └── GameConfigCommandServiceClient.lua
    │   │   │   │   ├── Config
    │   │   │   │   │   ├── Asset
    │   │   │   │   │   │   └── GameConfigAssetClient.lua
    │   │   │   │   │   └── Config
    │   │   │   │   │       └── GameConfigClient.lua
    │   │   │   │   ├── GameConfigBindersClient.lua
    │   │   │   │   └── GameConfigServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Cmdr
    │   │   │   │   │   └── GameConfigCommandService.lua
    │   │   │   │   ├── Config
    │   │   │   │   │   ├── Asset
    │   │   │   │   │   │   └── GameConfigAsset.lua
    │   │   │   │   │   └── Config
    │   │   │   │   │       └── GameConfig.lua
    │   │   │   │   ├── Mantle
    │   │   │   │   │   └── MantleConfigProvider.lua
    │   │   │   │   ├── GameConfigBindersServer.lua
    │   │   │   │   ├── GameConfigService.lua
    │   │   │   │   └── GameConfigServiceConstants.lua
    │   │   │   └── Shared
    │   │   │       ├── Cmdr
    │   │   │       │   └── GameConfigCmdrUtils.lua
    │   │   │       ├── Config
    │   │   │       │   ├── Asset
    │   │   │       │   │   ├── GameConfigAssetBase.lua
    │   │   │       │   │   ├── GameConfigAssetConstants.lua
    │   │   │       │   │   └── GameConfigAssetUtils.lua
    │   │   │       │   ├── AssetTypes
    │   │   │       │   │   ├── GameConfigAssetTypeUtils.lua
    │   │   │       │   │   └── GameConfigAssetTypes.lua
    │   │   │       │   ├── Config
    │   │   │       │   │   ├── GameConfigBase.lua
    │   │   │       │   │   ├── GameConfigConstants.lua
    │   │   │       │   │   └── GameConfigUtils.lua
    │   │   │       │   └── Picker
    │   │   │       │       └── GameConfigPicker.lua
    │   │   │       ├── GameConfigDataService.lua
    │   │   │       ├── GameConfigTags.rbxmx
    │   │   │       └── GameConfigTranslator.lua
    │   │   ├── test
    │   │   │   ├── assets
    │   │   │   │   └── badges
    │   │   │   │       └── badge.png
    │   │   │   ├── modules
    │   │   │   │   └── Server
    │   │   │   │       └── TestMantleConfigProvider
    │   │   │   │           ├── Staging.json
    │   │   │   │           └── init.lua
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   ├── default.project.json
    │   │   │   ├── jest.config.lua
    │   │   │   └── mantle.yml
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── gameproductservice
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Manager
    │   │   │   │   │   └── PlayerProductManagerClient.lua
    │   │   │   │   └── GameProductServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Cmdr
    │   │   │   │   │   └── GameProductCmdrService.lua
    │   │   │   │   ├── Manager
    │   │   │   │   │   └── PlayerProductManager.lua
    │   │   │   │   └── GameProductService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── Interfaces
    │   │   │   │   │   ├── PlayerAssetMarketTrackerInterface.lua
    │   │   │   │   │   └── PlayerProductManagerInterface.lua
    │   │   │   │   ├── Ownership
    │   │   │   │   │   └── PlayerAssetOwnershipTracker.lua
    │   │   │   │   ├── Trackers
    │   │   │   │   │   ├── PlayerAssetMarketTracker.lua
    │   │   │   │   │   └── PlayerProductManagerBase.lua
    │   │   │   │   └── GameProductDataService.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── gamescalingutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── GameScalingHelper.lua
    │   │   │       └── GameScalingUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── gameversionutils
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       └── GameVersionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── generatewithmixin
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── GenerateWithMixin.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── genericscreenguiprovider
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── GenericScreenGuiProvider.lua
    │   │   │       └── ScreenGuiService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── geometryutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── CameraPyramidUtils.lua
    │   │   │       ├── CircleUtils.lua
    │   │   │       ├── Line.lua
    │   │   │       ├── OrthogonalUtils.lua
    │   │   │       ├── PlaneUtils.lua
    │   │   │       ├── ScaleModelUtils.lua
    │   │   │       ├── SphereUtils.lua
    │   │   │       ├── SurfaceUtils.lua
    │   │   │       └── SwingTwistUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── getgroundplane
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── batchRaycast.lua
    │   │   │       └── getGroundPlane.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── getmechanismparts
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── getMechanismParts.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── getpercentexposedutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── GetPercentExposedUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── grouputils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── GroupUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── guitriangle
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── GuiTriangle.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── guivisiblemanager
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── GuiVisibleManager.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── hapticfeedbackutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── HapticFeedbackUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── hide
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── DynamicHideClient.lua
    │   │   │   │   ├── HideClient.lua
    │   │   │   │   └── HideServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── DynamicHide.lua
    │   │   │   │   ├── Hide.lua
    │   │   │   │   └── HideService.lua
    │   │   │   └── Shared
    │   │   │       ├── DynamicHideBase.lua
    │   │   │       ├── HideTagList.rbxmx
    │   │   │       └── HideUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── highlight
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── Stack
    │   │   │       │   ├── AnimatedHighlightModel.lua
    │   │   │       │   └── AnimatedHighlightStack.lua
    │   │   │       ├── AnimatedHighlight.lua
    │   │   │       ├── AnimatedHighlight.story.lua
    │   │   │       ├── AnimatedHighlightGroup.lua
    │   │   │       ├── AnimatedHighlightGroup.story.lua
    │   │   │       └── HighlightServiceClient.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── hintscoringutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── HintScoringUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── httppromise
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       └── HttpPromise.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── humanoidanimatorutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── HumanoidAnimatorUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── humanoiddescriptionutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── HumanoidDescriptionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── humanoidkillerutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── HumanoidKillerUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── humanoidmovedirectionutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── HumanoidMoveDirectionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── humanoidspeed
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── HumanoidSpeedBindersClient.lua
    │   │   │   │   └── HumanoidSpeedClient.lua
    │   │   │   └── Server
    │   │   │       ├── HumanoidSpeed.lua
    │   │   │       └── HumanoidSpeedBindersServer.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── humanoidteleportutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── HumanoidTeleportUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── humanoidtracker
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── HumanoidTracker.lua
    │   │   │       └── HumanoidTrackerService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── humanoidutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── HumanoidUtils.lua
    │   │   │       └── RxHumanoidUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── idleservice
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── IdleServiceClient.lua
    │   │   │   │   └── IdleTargetCalculator.lua
    │   │   │   └── Server
    │   │   │       └── IdleService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── ik
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Rig
    │   │   │   │   │   ├── IKRigAimerLocalPlayer.lua
    │   │   │   │   │   └── IKRigClient.lua
    │   │   │   │   ├── GripPointer.lua
    │   │   │   │   └── IKServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Rig
    │   │   │   │   │   └── IKRig.lua
    │   │   │   │   └── IKService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── Arm
    │   │   │   │   │   ├── ArmIKBase.lua
    │   │   │   │   │   ├── ArmIKBase.story.lua
    │   │   │   │   │   ├── ArmIKUtils.lua
    │   │   │   │   │   └── IKAimPositionPriorites.lua
    │   │   │   │   ├── Grip
    │   │   │   │   │   ├── IKGripBase.lua
    │   │   │   │   │   ├── IKGripUtils.lua
    │   │   │   │   │   ├── IKLeftGrip.lua
    │   │   │   │   │   └── IKRightGrip.lua
    │   │   │   │   ├── Interfaces
    │   │   │   │   │   └── IKRigInterface.lua
    │   │   │   │   ├── Resources
    │   │   │   │   │   ├── IKResource.lua
    │   │   │   │   │   └── IKResourceUtils.lua
    │   │   │   │   ├── Rig
    │   │   │   │   │   ├── IKRigBase.lua
    │   │   │   │   │   └── IKRigUtils.lua
    │   │   │   │   ├── Torso
    │   │   │   │   │   ├── TorsoIKBase.lua
    │   │   │   │   │   └── TorsoIKUtils.lua
    │   │   │   │   ├── IKDataService.lua
    │   │   │   │   ├── IKUtils.lua
    │   │   │   │   └── IKUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── influxdbclient
    │   │   ├── src
    │   │   │   ├── Server
    │   │   │   │   ├── Config
    │   │   │   │   │   ├── InfluxDBClientConfigUtils.lua
    │   │   │   │   │   └── InfluxDBWriteOptionUtils.lua
    │   │   │   │   ├── Utils
    │   │   │   │   │   └── InfluxDBErrorUtils.lua
    │   │   │   │   ├── Write
    │   │   │   │   │   ├── InfluxDBWriteAPI.lua
    │   │   │   │   │   └── InfluxDBWriteBuffer.lua
    │   │   │   │   ├── InfluxDBClient.lua
    │   │   │   │   └── InfluxDBClient.story.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── Config
    │   │   │   │   │   └── InfluxDBPointSettings.lua
    │   │   │   │   ├── Utils
    │   │   │   │   │   ├── InfluxDBEscapeUtils.lua
    │   │   │   │   │   └── InfluxDBEscapeUtils.spec.lua
    │   │   │   │   └── Write
    │   │   │   │       └── InfluxDBPoint.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── inputkeymaputils
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── InputKeyMapListUtils.lua
    │   │   │   │   └── InputKeyMapServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   └── InputKeyMapService.lua
    │   │   │   └── Shared
    │   │   │       ├── Types
    │   │   │       │   ├── InputChordUtils.lua
    │   │   │       │   ├── InputTypeUtils.lua
    │   │   │       │   ├── InputTypeUtils.spec.lua
    │   │   │       │   └── SlottedTouchButtonUtils.lua
    │   │   │       ├── HoldableInputModel.lua
    │   │   │       ├── InputKeyMap.lua
    │   │   │       ├── InputKeyMapList.lua
    │   │   │       ├── InputKeyMapListProvider.lua
    │   │   │       ├── InputKeyMapRegistryServiceShared.lua
    │   │   │       ├── InputKeyMapTranslator.lua
    │   │   │       └── ProximityPromptInputUtils.lua
    │   │   ├── test
    │   │   │   ├── modules
    │   │   │   │   └── Shared
    │   │   │   │       └── TestInputKeyMap.lua
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   ├── default.project.json
    │   │   │   └── jest.config.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── inputmode
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── InputMode.lua
    │   │   │   │   ├── InputModeProcessor.lua
    │   │   │   │   ├── InputModeServiceClient.lua
    │   │   │   │   └── InputModeTypeSelector.lua
    │   │   │   └── Shared
    │   │   │       ├── InputModeType.lua
    │   │   │       └── InputModeTypes.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── inputobjectutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── InputObjectRayUtils.lua
    │   │   │       ├── InputObjectTracker.lua
    │   │   │       ├── InputObjectUtils.lua
    │   │   │       └── RxInputObjectUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── insertserviceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── InsertServiceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── instanceutils
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── RxInstanceUtils.lua
    │   │   │   │   └── RxInstanceUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── isamixin
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── IsAMixin.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── jsonutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── JSONUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── jumpbuttonutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── JumpButtonUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── kinematics
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── KinematicUtils.lua
    │   │   │       └── Kinematics.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── linearsystemssolver
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── LinearSystemsSolverUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── linkutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── LinkUtils.lua
    │   │   │       └── RxLinkUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── lipsum
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── LipsumIconUtils.lua
    │   │   │   │   ├── LipsumUtils.lua
    │   │   │   │   ├── LipsumUtils.spec.lua
    │   │   │   │   └── LipsumUtils.story.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── loader
    │   │   ├── src
    │   │   │   ├── Dependencies
    │   │   │   │   ├── DependencyUtils.lua
    │   │   │   │   ├── PackageTracker.lua
    │   │   │   │   └── PackageTrackerProvider.lua
    │   │   │   ├── LoaderLink
    │   │   │   │   ├── LoaderLink.lua
    │   │   │   │   ├── LoaderLinkCreator.lua
    │   │   │   │   └── LoaderLinkUtils.lua
    │   │   │   ├── Replication
    │   │   │   │   ├── ReplicationType.lua
    │   │   │   │   ├── ReplicationTypeUtils.lua
    │   │   │   │   ├── Replicator.lua
    │   │   │   │   └── ReplicatorReferences.lua
    │   │   │   ├── LoaderUtils.lua
    │   │   │   ├── Maid.lua
    │   │   │   ├── Utils.lua
    │   │   │   └── init.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── localizedtextutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── LocalizedTextUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── lrucache
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── LRUCache.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── maid
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Maid.lua
    │   │   │   │   ├── Maid.story.lua
    │   │   │   │   ├── MaidTaskUtils.lua
    │   │   │   │   └── MaidTaskUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── markdownrender
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── MarkdownParser.lua
    │   │   │       └── MarkdownRender.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── marketplaceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── MarketplaceServiceCache.lua
    │   │   │       └── MarketplaceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── math
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Math.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── memoize
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── MemorizeUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── memorystoreutils
    │   │   ├── src
    │   │   │   └── MemoryStoreUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── meshutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── MeshUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── messagingserviceutils
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       ├── MessagingServiceUtils.lua
    │   │   │       └── PlaceMessagingService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── metricutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── MetricUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── modelappearance
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── ModelAppearance.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── modeltransparencyeffect
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── ModelTransparencyEffect.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── motor6d
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Humanoid
    │   │   │   │   │   └── Motor6DStackHumanoidClient.lua
    │   │   │   │   ├── Stack
    │   │   │   │   │   └── Motor6DStackClient.lua
    │   │   │   │   └── Motor6DServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Humanoid
    │   │   │   │   │   └── Motor6DStackHumanoid.lua
    │   │   │   │   ├── Stack
    │   │   │   │   │   └── Motor6DStack.lua
    │   │   │   │   └── Motor6DService.lua
    │   │   │   └── Shared
    │   │   │       ├── Animation
    │   │   │       │   ├── Motor6DAnimator.lua
    │   │   │       │   ├── Motor6DPhysicsTransformer.lua
    │   │   │       │   ├── Motor6DSmoothTransformer.lua
    │   │   │       │   └── Motor6DTransformer.lua
    │   │   │       ├── Humanoid
    │   │   │       │   ├── Motor6DStackHumanoidBase.lua
    │   │   │       │   └── Motor6DStackHumanoidInterface.lua
    │   │   │       └── Stack
    │   │   │           ├── Motor6DStackBase.lua
    │   │   │           └── Motor6DStackInterface.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── mouseovermixin
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── MouseOverMixin.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── mouseshiftlockservice
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── MouseShiftLockService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── multipleclickutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── MultipleClickUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── networkownerservice
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       └── NetworkOwnerService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── networkownerutils
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       └── NetworkOwnerUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── networkropeutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── NetworkRopeUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── nevermore-test-runner
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       └── NevermoreTestRunnerUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── nocollisionconstraintutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── NoCollisionConstraintUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── numberrangeutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── NumberRangeUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── numbersequenceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── NumberSequenceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── numbertoinputkeyutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── NumberToInputKeyUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── observablecollection
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── SortedList
    │   │   │   │   │   ├── ChangedSpanTracker.lua
    │   │   │   │   │   ├── ChangedSpanTracker.story.lua
    │   │   │   │   │   ├── ObservableSortedList.lua
    │   │   │   │   │   ├── ObservableSortedList.spec.lua
    │   │   │   │   │   ├── ObservableSortedList.story.lua
    │   │   │   │   │   ├── ObservableSortedList_Index.story.lua
    │   │   │   │   │   ├── ObservableSortedList_Performance.story.lua
    │   │   │   │   │   ├── ObservableSortedList_Print.story.lua
    │   │   │   │   │   ├── SortFunctionUtils.lua
    │   │   │   │   │   ├── SortedNode.lua
    │   │   │   │   │   └── SortedNodeValue.lua
    │   │   │   │   ├── Utils
    │   │   │   │   │   └── ListIndexUtils.lua
    │   │   │   │   ├── FilteredObservableListView.lua
    │   │   │   │   ├── ObservableCountingMap.lua
    │   │   │   │   ├── ObservableCountingMap.spec.lua
    │   │   │   │   ├── ObservableList.lua
    │   │   │   │   ├── ObservableList.spec.lua
    │   │   │   │   ├── ObservableMap.lua
    │   │   │   │   ├── ObservableMap.spec.lua
    │   │   │   │   ├── ObservableMapList.lua
    │   │   │   │   ├── ObservableMapList.spec.lua
    │   │   │   │   ├── ObservableMapSet.lua
    │   │   │   │   └── ObservableSet.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── octree
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Octree.lua
    │   │   │       ├── OctreeNode.lua
    │   │   │       └── OctreeRegionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── optional
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── optional.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── overriddenproperty
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── OverriddenProperty.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── pagesutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Proxy
    │   │   │       │   ├── PagesDatabase.lua
    │   │   │       │   └── PagesProxy.lua
    │   │   │       └── PagesUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── particleengine
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   └── ParticleEngineClient.lua
    │   │   │   ├── Server
    │   │   │   │   └── ParticleEngineServer.lua
    │   │   │   └── Shared
    │   │   │       └── ParticleEngineConstants.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── particles
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── ParticleEmitterUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── parttouchingcalculator
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── BinderTouchingCalculator.lua
    │   │   │       ├── PartTouchingCalculator.lua
    │   │   │       └── PartTouchingRenderer.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── pathfindingutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PathfindingUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── performanceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PerformanceUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── permissionprovider
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Providers
    │   │   │   │   │   └── PermissionProviderClient.lua
    │   │   │   │   └── PermissionServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Providers
    │   │   │   │   │   ├── BasePermissionProvider.lua
    │   │   │   │   │   ├── CreatorPermissionProvider.lua
    │   │   │   │   │   └── GroupPermissionProvider.lua
    │   │   │   │   ├── PermissionProviderUtils.lua
    │   │   │   │   └── PermissionService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── PermissionLevel.lua
    │   │   │   │   ├── PermissionLevel.spec.lua
    │   │   │   │   └── PermissionProviderConstants.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── physicsutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── PhysicsUtils.lua
    │   │   │       └── RxPhysicsUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── pillbacking
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── PillBackingBuilder.lua
    │   │   │       └── PillBackingUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── playerbinder
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       └── PlayerBinder.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── playerhumanoidbinder
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       ├── PlayerCharacterBinder.lua
    │   │   │       └── PlayerHumanoidBinder.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── playerinputmode
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   └── PlayerInputModeServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   └── PlayerInputModeService.lua
    │   │   │   └── Shared
    │   │   │       ├── PlayerInputModeServiceConstants.lua
    │   │   │       ├── PlayerInputModeTypes.lua
    │   │   │       └── PlayerInputModeUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── playersservicepromises
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PlayersServicePromises.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── playerthumbnailutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PlayerThumbnailUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── playerutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── PlayerUtils.lua
    │   │   │       └── RxPlayerUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── policyserviceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PolicyServiceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── polynomialutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PolynomialUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── preferredparentutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PreferredParentUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── probability
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Probability.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── promise
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Utility
    │   │   │       │   ├── PendingPromiseTracker.lua
    │   │   │       │   ├── PromiseInstanceUtils.lua
    │   │   │       │   ├── promiseChild.lua
    │   │   │       │   ├── promisePropertyValue.lua
    │   │   │       │   └── promiseWait.lua
    │   │   │       ├── Promise.lua
    │   │   │       ├── PromiseRetryUtils.lua
    │   │   │       └── PromiseUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── promisemaid
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PromiseMaidUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── promptqueue
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PromptQueue.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── propertyvalue
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PropertyValue.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── pseudolocalize
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── PseudoLocalize.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── qframe
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── QFrame.lua
    │   │   │       └── QFrame.story.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── qgui
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── qGUI.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── quaternion
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Quaternion.lua
    │   │   │       └── QuaternionObject.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── queue
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Queue.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── r15utils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── R15Utils.lua
    │   │   │       └── RxR15Utils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── racketingropeconstraint
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RacketingRopeConstraint.lua
    │   │   │       └── RacketingRopeConstraintInterface.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── radial-image
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── RadialImage.lua
    │   │   │       └── RadialImage.story.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── ragdoll
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Classes
    │   │   │   │   │   ├── RagdollCameraShakeClient.lua
    │   │   │   │   │   ├── RagdollClient.lua
    │   │   │   │   │   ├── RagdollHumanoidOnDeathClient.lua
    │   │   │   │   │   ├── RagdollHumanoidOnFallClient.lua
    │   │   │   │   │   └── RagdollableClient.lua
    │   │   │   │   ├── RagdollBindersClient.lua
    │   │   │   │   └── RagdollServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Classes
    │   │   │   │   │   ├── Ragdoll.lua
    │   │   │   │   │   ├── RagdollCameraShake.lua
    │   │   │   │   │   ├── RagdollHumanoidOnDeath.lua
    │   │   │   │   │   ├── RagdollHumanoidOnFall.lua
    │   │   │   │   │   ├── Ragdollable.lua
    │   │   │   │   │   ├── UnragdollAutomatically.lua
    │   │   │   │   │   └── UnragdollAutomaticallyConstants.lua
    │   │   │   │   ├── RagdollBindersServer.lua
    │   │   │   │   └── RagdollService.lua
    │   │   │   └── Shared
    │   │   │       ├── Classes
    │   │   │       │   ├── BindableRagdollHumanoidOnFall.lua
    │   │   │       │   ├── RagdollHumanoidOnFallConstants.lua
    │   │   │       │   └── RagdollableBase.lua
    │   │   │       ├── Interfaces
    │   │   │       │   └── RagdollableInterface.lua
    │   │   │       ├── Rigging
    │   │   │       │   ├── RagdollAdditionalAttachmentUtils.lua
    │   │   │       │   ├── RagdollBallSocketUtils.lua
    │   │   │       │   ├── RagdollCollisionUtils.lua
    │   │   │       │   ├── RagdollMotorData.lua
    │   │   │       │   ├── RagdollMotorLimitData.lua
    │   │   │       │   ├── RagdollMotorUtils.lua
    │   │   │       │   └── RxRagdollUtils.lua
    │   │   │       └── RagdollServiceConstants.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── randomutils
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── RandomSampler.lua
    │   │   │   │   ├── RandomUtils.lua
    │   │   │   │   ├── RandomUtils.spec.lua
    │   │   │   │   └── WeightedRandomChooser.lua
    │   │   │   └── jest.config.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── raycaster
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RaycastUtils.lua
    │   │   │       └── Raycaster.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── rbxasset
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── RbxAssetUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── rbxthumb
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RbxThumbUtils.lua
    │   │   │       └── RbxThumbnailTypes.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── receiptprocessing
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       └── ReceiptProcessingService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── rectutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── RectUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── region3int16utils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Region3int16Utils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── region3utils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Region3Utils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── remotefunctionutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── RemoteFunctionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── remoting
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Interface
    │   │   │       │   ├── Remoting.lua
    │   │   │       │   └── RemotingMember.lua
    │   │   │       ├── Realm
    │   │   │       │   ├── RemotingRealmUtils.lua
    │   │   │       │   └── RemotingRealms.lua
    │   │   │       ├── GetRemoteEvent.lua
    │   │   │       ├── GetRemoteFunction.lua
    │   │   │       ├── PromiseGetRemoteEvent.lua
    │   │   │       ├── PromiseGetRemoteFunction.lua
    │   │   │       ├── PromiseRemoteEventMixin.lua
    │   │   │       ├── PromiseRemoteFunctionMixin.lua
    │   │   │       └── ResourceConstants.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── resetservice
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   └── ResetServiceClient.lua
    │   │   │   └── Server
    │   │   │       └── ResetService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── richtext
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── RichTextUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── roblox-api-dump
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       ├── RobloxApiClass.lua
    │   │   │       ├── RobloxApiDump.lua
    │   │   │       ├── RobloxApiDumpConstants.lua
    │   │   │       ├── RobloxApiMember.lua
    │   │   │       └── RobloxApiUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── rodux-actions
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RoduxActionFactory.lua
    │   │   │       └── RoduxActions.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── rodux-undo
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── UndoableReducer.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── rogue-humanoid
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── RogueHumanoidClient.lua
    │   │   │   │   └── RogueHumanoidServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── RogueHumanoid.lua
    │   │   │   │   └── RogueHumanoidService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── RogueHumanoidBase.lua
    │   │   │   │   └── RogueHumanoidProperties.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── rogue-properties
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Array
    │   │   │   │   │   ├── RoguePropertyArrayConstants.lua
    │   │   │   │   │   └── RoguePropertyArrayUtils.lua
    │   │   │   │   ├── Cache
    │   │   │   │   │   ├── RoguePropertyCache.lua
    │   │   │   │   │   └── RoguePropertyCacheService.lua
    │   │   │   │   ├── Definition
    │   │   │   │   │   ├── RoguePropertyDefinition.lua
    │   │   │   │   │   ├── RoguePropertyDefinitionArrayHelper.lua
    │   │   │   │   │   └── RoguePropertyTableDefinition.lua
    │   │   │   │   ├── Implementation
    │   │   │   │   │   ├── RogueProperty.lua
    │   │   │   │   │   ├── RoguePropertyArrayHelper.lua
    │   │   │   │   │   ├── RoguePropertyTable.lua
    │   │   │   │   │   └── RoguePropertyUtils.lua
    │   │   │   │   ├── Modifiers
    │   │   │   │   │   ├── Implementations
    │   │   │   │   │   │   ├── RogueAdditive.lua
    │   │   │   │   │   │   ├── RogueModifierBase.lua
    │   │   │   │   │   │   ├── RogueMultiplier.lua
    │   │   │   │   │   │   └── RogueSetter.lua
    │   │   │   │   │   ├── RogueModifierInterface.lua
    │   │   │   │   │   └── RoguePropertyModifierData.lua
    │   │   │   │   ├── RoguePropertyBaseValueTypeUtils.lua
    │   │   │   │   ├── RoguePropertyBaseValueTypeUtils.spec.lua
    │   │   │   │   ├── RoguePropertyBaseValueTypes.lua
    │   │   │   │   ├── RoguePropertyConstants.lua
    │   │   │   │   └── RoguePropertyService.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── rotatinglabel
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── RotatingCharacter.lua
    │   │   │       ├── RotatingCharacterBuilder.lua
    │   │   │       ├── RotatingLabel.lua
    │   │   │       └── RotatingLabelBuilder.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── rx
    │   │   ├── src
    │   │   │   ├── Shared
    │   │   │   │   ├── Observable.lua
    │   │   │   │   ├── ObservablePerformance.story.lua
    │   │   │   │   ├── ObservableSubscriptionTable.lua
    │   │   │   │   ├── Rx.lua
    │   │   │   │   ├── Rx.spec.lua
    │   │   │   │   └── Subscription.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── rxbinderutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RxBinderGroupUtils.lua
    │   │   │       └── RxBinderUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── rxsignal
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── RxSignal.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── safedestroy
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── safeDestroy.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── scoredactionservice
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── InputList
    │   │   │   │   │   └── InputListScoreHelper.lua
    │   │   │   │   ├── Picker
    │   │   │   │   │   ├── ScoredActionPicker.lua
    │   │   │   │   │   ├── ScoredActionPickerProvider.lua
    │   │   │   │   │   └── TouchButtonScoredActionPicker.lua
    │   │   │   │   ├── ScoredAction.lua
    │   │   │   │   ├── ScoredActionServiceClient.lua
    │   │   │   │   └── ScoredActionUtils.lua
    │   │   │   └── Server
    │   │   │       └── ScoredActionService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── screenshothudservice
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── ScreenshotHudModel.lua
    │   │   │   │   └── ScreenshotHudServiceClient.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── scrollingframe
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── SCROLL_TYPE.lua
    │   │   │       ├── ScrollModel.lua
    │   │   │       ├── Scrollbar.lua
    │   │   │       └── ScrollingFrame.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── seatutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RxSeatUtils.lua
    │   │   │       └── SeatUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── secrets
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   └── SecretsServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Cmdr
    │   │   │   │   │   └── SecretsCommandService.lua
    │   │   │   │   └── SecretsService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── Cmdr
    │   │   │   │   │   └── SecretsCmdrTypeUtils.lua
    │   │   │   │   ├── SecretsServiceConstants.lua
    │   │   │   │   └── SecretsServiceConstants.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── selectionimageutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── SelectionImageUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── selectionutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── RxSelectionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── servicebag
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── ServiceBag.lua
    │   │   │       └── ServiceInitLogger.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── setmechanismcframe
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── setMechanismCFrame.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── settings
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Player
    │   │   │   │   │   └── PlayerSettingsClient.lua
    │   │   │   │   └── SettingsServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── Cmdr
    │   │   │   │   │   └── SettingsCmdrService.lua
    │   │   │   │   ├── Player
    │   │   │   │   │   ├── PlayerHasSettings.lua
    │   │   │   │   │   └── PlayerSettings.lua
    │   │   │   │   └── SettingsService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── Cmdr
    │   │   │   │   │   └── SettingsCmdrUtils.lua
    │   │   │   │   ├── Interface
    │   │   │   │   │   └── PlayerSettingsInterface.lua
    │   │   │   │   ├── Player
    │   │   │   │   │   ├── PlayerSettingsBase.lua
    │   │   │   │   │   ├── PlayerSettingsConstants.lua
    │   │   │   │   │   ├── PlayerSettingsUtils.lua
    │   │   │   │   │   └── PlayerSettingsUtils.spec.lua
    │   │   │   │   ├── Setting
    │   │   │   │   │   ├── SettingDefinition.lua
    │   │   │   │   │   ├── SettingDefinitionProvider.lua
    │   │   │   │   │   └── SettingProperty.lua
    │   │   │   │   └── SettingsDataService.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── settings-inputkeymap
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── InputKeyMapSettingClient.lua
    │   │   │   │   └── SettingsInputKeyMapServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── InputKeyMapSetting.lua
    │   │   │   │   └── SettingsInputKeyMapService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── InputKeyMapSettingConstants.lua
    │   │   │   │   ├── InputKeyMapSettingConstants.spec.lua
    │   │   │   │   └── InputKeyMapSettingUtils.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── signal
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── EventHandlerUtils.lua
    │   │   │       ├── OldSignal.lua
    │   │   │       ├── Signal.lua
    │   │   │       ├── Signal.story.lua
    │   │   │       └── SignalUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── singleton
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Singleton.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── snackbar
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Gui
    │   │   │   │   │   └── Snackbar.lua
    │   │   │   │   ├── SnackbarScreenGuiProvider.lua
    │   │   │   │   ├── SnackbarServiceClient.lua
    │   │   │   │   └── SnackbarServiceClient.story.lua
    │   │   │   ├── Server
    │   │   │   │   └── SnackbarService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── SnackbarOptionUtils.lua
    │   │   │   │   └── SnackbarOptionUtils.spec.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── socialserviceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── SocialServiceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── softshutdown
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── SoftShutdownServiceClient.lua
    │   │   │   │   ├── SoftShutdownUI.lua
    │   │   │   │   └── SoftShutdownUI.story.lua
    │   │   │   ├── Server
    │   │   │   │   └── SoftShutdownService.lua
    │   │   │   └── Shared
    │   │   │       ├── SoftShutdownConstants.lua
    │   │   │       └── SoftShutdownTranslator.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── init.client.lua
    │   │   │   │   └── Server
    │   │   │   │       ├── client.project.json
    │   │   │   │       ├── init.server.lua
    │   │   │   │       └── src.project.json
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── soundgroups
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   └── SoundGroupServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   └── SoundGroupService.lua
    │   │   │   ├── Shared
    │   │   │   │   ├── Effects
    │   │   │   │   │   ├── SoundEffectsList.lua
    │   │   │   │   │   └── SoundEffectsRegistry.lua
    │   │   │   │   ├── Groups
    │   │   │   │   │   └── WellKnownSoundGroups.lua
    │   │   │   │   ├── Utils
    │   │   │   │   │   ├── SoundGroupPathUtils.lua
    │   │   │   │   │   └── SoundGroupPathUtils.spec.lua
    │   │   │   │   ├── Volume
    │   │   │   │   │   ├── SoundGroupVolume.lua
    │   │   │   │   │   ├── SoundGroupVolumeInterface.lua
    │   │   │   │   │   └── SoundGroupVolumeProperties.lua
    │   │   │   │   ├── SoundEffectService.lua
    │   │   │   │   └── SoundGroupTracker.lua
    │   │   │   └── jest.config.lua
    │   │   ├── test
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── soundplayer
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   ├── Loops
    │   │   │   │   │   ├── Layered
    │   │   │   │   │   │   ├── LayeredLoopedSoundPlayer.lua
    │   │   │   │   │   │   ├── LayeredLoopedSoundPlayer.story.lua
    │   │   │   │   │   │   └── LayeredSoundHelper.lua
    │   │   │   │   │   ├── LoopedSoundPlayer.lua
    │   │   │   │   │   ├── LoopedSoundPlayer.story.lua
    │   │   │   │   │   ├── SimpleLoopedSoundPlayer.lua
    │   │   │   │   │   └── SimpleLoopedSoundPlayer.story.lua
    │   │   │   │   ├── Schedule
    │   │   │   │   │   └── SoundLoopScheduleUtils.lua
    │   │   │   │   ├── Service
    │   │   │   │   │   └── SoundPlayerServiceClient.lua
    │   │   │   │   └── Stack
    │   │   │   │       └── SoundPlayerStack.lua
    │   │   │   └── Server
    │   │   │       └── SoundPlayerService.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── sounds
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── SoundPromiseUtils.lua
    │   │   │       └── SoundUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── spawning
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   └── SpawnServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   ├── SpawnBinderGroupsServer.lua
    │   │   │   │   ├── SpawnCmdrService.lua
    │   │   │   │   └── SpawnService.lua
    │   │   │   └── Shared
    │   │   │       └── SpawnerUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── spring
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── LinearValue.lua
    │   │   │       ├── Spring.lua
    │   │   │       └── SpringUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── sprites
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── InputImageLibrary
    │   │   │       │   ├── Spritesheets
    │   │   │       │   │   ├── Keyboard
    │   │   │       │   │   │   ├── Dark.lua
    │   │   │       │   │   │   ├── Light.lua
    │   │   │       │   │   │   └── readme.md
    │   │   │       │   │   ├── PlayStation
    │   │   │       │   │   │   └── Dark.lua
    │   │   │       │   │   ├── Touch
    │   │   │       │   │   │   └── All.lua
    │   │   │       │   │   └── XBox
    │   │   │       │   │       ├── Dark.lua
    │   │   │       │   │       └── Light.lua
    │   │   │       │   ├── InputImageLibrary.story.lua
    │   │   │       │   └── init.lua
    │   │   │       └── Sprite
    │   │   │           ├── Sprite.lua
    │   │   │           └── Spritesheet.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── statestack
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RxStateStackUtils.lua
    │   │   │       └── StateStack.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── steputils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── StepUtils.lua
    │   │   │       ├── onRenderStepFrame.lua
    │   │   │       └── onSteppedFrame.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── streamingutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── StreamingUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── string
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── String.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── sunpositionutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── SunPositionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── symbol
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Symbol.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── table
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Set.lua
    │   │   │       └── Table.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── teamtracker
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── TeamTracker.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── teamutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RxTeamUtils.lua
    │   │   │       └── TeamUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── teleportserviceutils
    │   │   ├── src
    │   │   │   └── Server
    │   │   │       ├── RxTeleportUtils.lua
    │   │   │       └── TeleportServiceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── templateprovider
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Modules
    │   │   │       │   ├── ModuleProvider.lua
    │   │   │       │   └── ModuleProviderFakeLoader.lua
    │   │   │       ├── Replication
    │   │   │       │   └── Util
    │   │   │       │       ├── TemplateReplicationModes.lua
    │   │   │       │       └── TemplateReplicationModesUtils.lua
    │   │   │       ├── TaggedTemplateProvider.lua
    │   │   │       └── TemplateProvider.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── terrainutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── TerrainUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── textboxutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── RxTextBoxUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── textfilterservice
    │   │   ├── src
    │   │   │   ├── Client
    │   │   │   │   └── TextFilterServiceClient.lua
    │   │   │   ├── Server
    │   │   │   │   └── TextFilterService.lua
    │   │   │   └── Shared
    │   │   │       └── TextFilterServiceConstants.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── textfilterutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── TextFilterUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── textserviceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── TextServiceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── throttle
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── ThrottledFunction.lua
    │   │   │       └── throttle.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── tie
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Members
    │   │   │       │   ├── Methods
    │   │   │       │   │   ├── TieMethodDefinition.lua
    │   │   │       │   │   ├── TieMethodImplementation.lua
    │   │   │       │   │   └── TieMethodInterfaceUtils.lua
    │   │   │       │   ├── Properties
    │   │   │       │   │   ├── TiePropertyDefinition.lua
    │   │   │       │   │   ├── TiePropertyImplementation.lua
    │   │   │       │   │   ├── TiePropertyImplementationUtils.lua
    │   │   │       │   │   └── TiePropertyInterface.lua
    │   │   │       │   ├── Signals
    │   │   │       │   │   ├── TieSignalConnection.lua
    │   │   │       │   │   ├── TieSignalDefinition.lua
    │   │   │       │   │   ├── TieSignalImplementation.lua
    │   │   │       │   │   └── TieSignalInterface.lua
    │   │   │       │   ├── TieMemberDefinition.lua
    │   │   │       │   └── TieMemberInterface.lua
    │   │   │       ├── Realms
    │   │   │       │   ├── TieRealmUtils.lua
    │   │   │       │   └── TieRealms.lua
    │   │   │       ├── Services
    │   │   │       │   └── TieRealmService.lua
    │   │   │       ├── Utils
    │   │   │       │   ├── TieUtils.lua
    │   │   │       │   └── TieUtils.spec.lua
    │   │   │       ├── TieDefinition.lua
    │   │   │       ├── TieImplementation.lua
    │   │   │       └── TieInterface.lua
    │   │   ├── test
    │   │   │   ├── modules
    │   │   │   │   └── Server
    │   │   │   │       ├── Action
    │   │   │   │       │   ├── Action.lua
    │   │   │   │       │   └── ActionInterface.lua
    │   │   │   │       ├── Door.lua
    │   │   │   │       ├── OpenableInterface.lua
    │   │   │   │       └── Window.lua
    │   │   │   ├── scripts
    │   │   │   │   ├── Client
    │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   └── Server
    │   │   │   │       └── ServerMain.server.lua
    │   │   │   ├── default.project.json
    │   │   │   └── jest.config.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── deploy.nevermore.json
    │   │   └── package.json
    │   ├── time
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Time.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── timedtween
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── TimedTween.lua
    │   │   │       └── TimedTween.story.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── timesyncservice
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Clocks
    │   │   │       │   ├── BaseClock.lua
    │   │   │       │   ├── MasterClock.lua
    │   │   │       │   └── SlaveClock.lua
    │   │   │       ├── TimeSyncConstants.lua
    │   │   │       ├── TimeSyncService.lua
    │   │   │       └── TimeSyncUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── toolutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RxToolUtils.lua
    │   │   │       └── ToolUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── touchingpartutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── TouchingPartUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── trajectory
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── MinEntranceVelocityUtils.lua
    │   │   │       ├── TrajectoryDrawUtils.lua
    │   │   │       └── trajectory.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── transitionmodel
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Sustain
    │   │   │       │   └── SustainModel.lua
    │   │   │       ├── Timed
    │   │   │       │   └── TimedTransitionModel.lua
    │   │   │       ├── SpringTransitionModel.lua
    │   │   │       ├── TransitionModel.lua
    │   │   │       └── TransitionUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── transparencyservice
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── TransparencyService.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── tuple
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── Tuple.lua
    │   │   │       ├── Tuple.story.lua
    │   │   │       └── TupleLookup.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── typeutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── TypeUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── ugcsanitize
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── DisableHatParticles.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── uiobjectutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── GuiInteractionUtils.lua
    │   │   │       ├── PlayerGuiUtils.lua
    │   │   │       ├── RxClippedRectUtils.lua
    │   │   │       ├── ScrollingDirectionUtils.lua
    │   │   │       ├── UIAlignmentUtils.lua
    │   │   │       ├── UICornerUtils.lua
    │   │   │       ├── UIPaddingUtils.lua
    │   │   │       └── UIRotationUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── ultrawidecontainerutils
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       └── UltrawideContainerUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── undostack
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── UndoStack.lua
    │   │   │       └── UndoStackEntry.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── userserviceutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── UserInfoAggregator.lua
    │   │   │       ├── UserInfoService.lua
    │   │   │       └── UserServiceUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── utf8
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── UTF8.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── valuebaseutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RxValueBaseUtils.lua
    │   │   │       ├── ValueBaseUtils.lua
    │   │   │       └── ValueBaseValue.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── valueobject
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── ValueObject.lua
    │   │   │       ├── ValueObject.story.lua
    │   │   │       └── ValueObjectUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── vector3int16utils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── Vector3int16Utils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── vector3utils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       ├── RandomVector3Utils.lua
    │   │   │       ├── Vector3SerializationUtils.lua
    │   │   │       └── Vector3Utils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── viewport
    │   │   ├── src
    │   │   │   └── Client
    │   │   │       ├── Viewport.lua
    │   │   │       ├── Viewport.story.lua
    │   │   │       └── ViewportControls.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── voicechat
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── VoiceChatUtils.lua
    │   │   ├── test
    │   │   │   └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   ├── weldconstraintutils
    │   │   ├── src
    │   │   │   └── Shared
    │   │   │       └── WeldConstraintUtils.lua
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   └── package.json
    │   └── README.md
    ├── tools
    │   ├── nevermore-cli
    │   │   ├── src
    │   │   │   ├── args
    │   │   │   │   └── global-args.ts
    │   │   │   ├── commands
    │   │   │   │   ├── batch-command
    │   │   │   │   │   ├── batch-deploy-command.ts
    │   │   │   │   │   ├── batch-test-command.ts
    │   │   │   │   │   └── index.ts
    │   │   │   │   ├── deploy-command
    │   │   │   │   │   ├── deploy-init-prompts.ts
    │   │   │   │   │   ├── deploy-init-utils.ts
    │   │   │   │   │   ├── deploy-init.ts
    │   │   │   │   │   └── index.ts
    │   │   │   │   ├── init-command
    │   │   │   │   │   ├── index.ts
    │   │   │   │   │   ├── init-game-command.ts
    │   │   │   │   │   ├── init-package-command.ts
    │   │   │   │   │   └── init-plugin-command.ts
    │   │   │   │   ├── test-command
    │   │   │   │   │   └── test-command.ts
    │   │   │   │   ├── tools-command
    │   │   │   │   │   ├── ci-post-deploy-results.ts
    │   │   │   │   │   ├── ci-post-lint-results.ts
    │   │   │   │   │   ├── ci-post-test-results.ts
    │   │   │   │   │   ├── download-roblox-types.ts
    │   │   │   │   │   ├── index.ts
    │   │   │   │   │   └── strip-sourcemap-jest-command.ts
    │   │   │   │   ├── install-package-command.ts
    │   │   │   │   └── login-command.ts
    │   │   │   ├── utils
    │   │   │   │   ├── auth
    │   │   │   │   │   ├── roblox-auth
    │   │   │   │   │   │   ├── cookie-parser.ts
    │   │   │   │   │   │   ├── index.ts
    │   │   │   │   │   │   ├── macos.ts
    │   │   │   │   │   │   └── windows.ts
    │   │   │   │   │   └── credential-store.ts
    │   │   │   │   ├── batch
    │   │   │   │   │   ├── batch-runner.ts
    │   │   │   │   │   └── changed-packages-utils.ts
    │   │   │   │   ├── deploy
    │   │   │   │   │   └── deploy-github-columns.ts
    │   │   │   │   ├── job-context
    │   │   │   │   │   ├── base-job-context.ts
    │   │   │   │   │   ├── batch-script-job-context.ts
    │   │   │   │   │   ├── cloud-job-context.ts
    │   │   │   │   │   ├── index.ts
    │   │   │   │   │   ├── job-context.ts
    │   │   │   │   │   └── local-job-context.ts
    │   │   │   │   ├── linting
    │   │   │   │   │   └── parsers
    │   │   │   │   │       ├── index.ts
    │   │   │   │   │       ├── lerna-utils.ts
    │   │   │   │   │       ├── luau-lsp-parser.test.ts
    │   │   │   │   │       ├── luau-lsp-parser.ts
    │   │   │   │   │       ├── moonwave-parser.test.ts
    │   │   │   │   │       ├── moonwave-parser.ts
    │   │   │   │   │       ├── selene-parser.test.ts
    │   │   │   │   │       ├── selene-parser.ts
    │   │   │   │   │       ├── stylua-parser.test.ts
    │   │   │   │   │       └── stylua-parser.ts
    │   │   │   │   ├── open-cloud
    │   │   │   │   │   ├── open-cloud-client.ts
    │   │   │   │   │   └── rate-limiter.ts
    │   │   │   │   ├── sourcemap
    │   │   │   │   │   ├── index.ts
    │   │   │   │   │   ├── sourcemap-loader.ts
    │   │   │   │   │   ├── sourcemap-resolver.test.ts
    │   │   │   │   │   ├── sourcemap-resolver.ts
    │   │   │   │   │   └── sourcemap-types.ts
    │   │   │   │   ├── testing
    │   │   │   │   │   ├── parsers
    │   │   │   │   │   │   ├── batch-log-parser.ts
    │   │   │   │   │   │   ├── index.ts
    │   │   │   │   │   │   ├── jest-lua-parser.test.ts
    │   │   │   │   │   │   ├── jest-lua-parser.ts
    │   │   │   │   │   │   ├── roblox-path-resolver.test.ts
    │   │   │   │   │   │   └── roblox-path-resolver.ts
    │   │   │   │   │   ├── reporting
    │   │   │   │   │   │   ├── README.md
    │   │   │   │   │   │   ├── index.ts
    │   │   │   │   │   │   ├── test-github-columns.ts
    │   │   │   │   │   │   └── test-types.ts
    │   │   │   │   │   ├── runner
    │   │   │   │   │   │   ├── combined-project-generator.ts
    │   │   │   │   │   │   └── test-runner.ts
    │   │   │   │   │   └── test-log-parser.ts
    │   │   │   │   └── nevermore-cli-utils.ts
    │   │   │   └── nevermore.ts
    │   │   ├── templates
    │   │   │   ├── game-template
    │   │   │   │   ├── gitignore
    │   │   │   │   ├── npmrc
    │   │   │   │   ├── src
    │   │   │   │   │   ├── modules
    │   │   │   │   │   │   ├── Client
    │   │   │   │   │   │   │   ├── Binders
    │   │   │   │   │   │   │   │   └── ENSURE_FOLDER_CREATED
    │   │   │   │   │   │   │   └── {{gameNameProper}}ServiceClient.lua
    │   │   │   │   │   │   ├── Server
    │   │   │   │   │   │   │   ├── Binders
    │   │   │   │   │   │   │   │   └── ENSURE_FOLDER_CREATED
    │   │   │   │   │   │   │   └── {{gameNameProper}}Service.lua
    │   │   │   │   │   │   └── Shared
    │   │   │   │   │   │       ├── ENSURE_FOLDER_CREATED
    │   │   │   │   │   │       └── {{gameNameProper}}Translator.lua
    │   │   │   │   │   └── scripts
    │   │   │   │   │       ├── Client
    │   │   │   │   │       │   └── ClientMain.client.lua
    │   │   │   │   │       └── Server
    │   │   │   │   │           └── ServerMain.server.lua
    │   │   │   │   ├── README.md
    │   │   │   │   ├── aftman.toml
    │   │   │   │   ├── default.project.json
    │   │   │   │   ├── package.json
    │   │   │   │   ├── pnpm-workspace.yaml
    │   │   │   │   ├── selene.toml
    │   │   │   │   ├── stylua.toml
    │   │   │   │   ├── {{gameName}}.code-workspace
    │   │   │   │   └── {{gameName}}.sublime-project
    │   │   │   ├── nevermore-library-package-template
    │   │   │   │   ├── src
    │   │   │   │   │   ├── Client
    │   │   │   │   │   │   └── ENSURE_FOLDER_CREATED
    │   │   │   │   │   ├── Server
    │   │   │   │   │   │   └── ENSURE_FOLDER_CREATED
    │   │   │   │   │   └── Shared
    │   │   │   │   │       └── {{packageNameProper}}Utils.lua
    │   │   │   │   ├── test
    │   │   │   │   │   └── default.project.json
    │   │   │   │   ├── README.md
    │   │   │   │   ├── default.project.json
    │   │   │   │   └── package.json
    │   │   │   ├── nevermore-service-package-template
    │   │   │   │   ├── src
    │   │   │   │   │   ├── Client
    │   │   │   │   │   │   └── {{packageNameProper}}ServiceClient.lua
    │   │   │   │   │   ├── Server
    │   │   │   │   │   │   └── {{packageNameProper}}Service.lua
    │   │   │   │   │   └── Shared
    │   │   │   │   │       └── ENSURE_FOLDER_CREATED
    │   │   │   │   ├── test
    │   │   │   │   │   ├── scripts
    │   │   │   │   │   │   ├── Client
    │   │   │   │   │   │   │   └── ClientMain.client.lua
    │   │   │   │   │   │   └── Server
    │   │   │   │   │   │       └── ServerMain.server.lua
    │   │   │   │   │   └── default.project.json
    │   │   │   │   ├── README.md
    │   │   │   │   ├── default.project.json
    │   │   │   │   └── package.json
    │   │   │   ├── plugin-template
    │   │   │   │   ├── gitignore
    │   │   │   │   ├── npmrc
    │   │   │   │   ├── src
    │   │   │   │   │   ├── modules
    │   │   │   │   │   │   ├── Client
    │   │   │   │   │   │   │   └── ENSURE_FOLDER_CREATED
    │   │   │   │   │   │   ├── Server
    │   │   │   │   │   │   │   └── ENSURE_FOLDER_CREATED
    │   │   │   │   │   │   └── Shared
    │   │   │   │   │   │       └── ENSURE_FOLDER_CREATED
    │   │   │   │   │   └── init.server.lua
    │   │   │   │   ├── README.md
    │   │   │   │   ├── aftman.toml
    │   │   │   │   ├── default.project.json
    │   │   │   │   ├── package.json
    │   │   │   │   ├── pnpm-workspace.yaml
    │   │   │   │   ├── selene.toml
    │   │   │   │   ├── stylua.toml
    │   │   │   │   ├── {{pluginName}}.code-workspace
    │   │   │   │   └── {{pluginName}}.sublime-project
    │   │   │   └── batch-test-runner.luau
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── package.json
    │   │   └── tsconfig.json
    │   ├── nevermore-cli-helpers
    │   │   ├── src
    │   │   │   ├── utils.ts
    │   │   │   └── version-checker.ts
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── package.json
    │   │   └── tsconfig.json
    │   ├── nevermore-template-helpers
    │   │   ├── src
    │   │   │   ├── scaffolding
    │   │   │   │   ├── index.ts
    │   │   │   │   ├── resolve-template-path.ts
    │   │   │   │   └── template-helpers.ts
    │   │   │   ├── substitution
    │   │   │   │   ├── index.ts
    │   │   │   │   └── substitute-template.ts
    │   │   │   └── index.ts
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── default.project.json
    │   │   ├── package.json
    │   │   └── tsconfig.json
    │   ├── nevermore-vscode
    │   │   ├── snippets
    │   │   │   └── luau.code-snippets
    │   │   ├── src
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   └── package.json
    │   ├── scripts
    │   │   └── enforce_pnpm.py
    │   ├── studio-bridge
    │   │   ├── src
    │   │   │   ├── cli
    │   │   │   │   ├── args
    │   │   │   │   │   └── global-args.ts
    │   │   │   │   ├── commands
    │   │   │   │   │   ├── terminal
    │   │   │   │   │   │   ├── terminal-command.ts
    │   │   │   │   │   │   ├── terminal-editor.ts
    │   │   │   │   │   │   └── terminal-mode.ts
    │   │   │   │   │   ├── exec-command.ts
    │   │   │   │   │   └── run-command.ts
    │   │   │   │   ├── cli.ts
    │   │   │   │   ├── index.ts
    │   │   │   │   └── script-executor.ts
    │   │   │   ├── plugin
    │   │   │   │   ├── index.ts
    │   │   │   │   ├── plugin-injector.test.ts
    │   │   │   │   └── plugin-injector.ts
    │   │   │   ├── process
    │   │   │   │   ├── index.ts
    │   │   │   │   ├── studio-process-manager.test.ts
    │   │   │   │   └── studio-process-manager.ts
    │   │   │   ├── server
    │   │   │   │   ├── index.ts
    │   │   │   │   ├── studio-bridge-server.test.ts
    │   │   │   │   ├── studio-bridge-server.ts
    │   │   │   │   ├── web-socket-protocol.smoke.test.ts
    │   │   │   │   ├── web-socket-protocol.test.ts
    │   │   │   │   └── web-socket-protocol.ts
    │   │   │   └── index.ts
    │   │   ├── templates
    │   │   │   ├── default-test-place
    │   │   │   │   └── default.project.json
    │   │   │   └── studio-bridge-plugin
    │   │   │       ├── src
    │   │   │       │   └── StudioBridgePlugin.server.lua
    │   │   │       └── default.project.json
    │   │   ├── CHANGELOG.md
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   └── tsconfig.json
    │   ├── CLAUDE.md
    │   ├── README.md
    │   └── update_readme.py
    ├── CHANGELOG.md
    ├── CLAUDE.md
    ├── LICENSE.md
    ├── Nevermore.code-workspace
    ├── Nevermore.sublime-project
    ├── aftman.toml
    ├── default.project.json
    ├── deploy.nevermore.json
    ├── foreman.toml
    ├── lerna.json
    ├── moonwave.toml
    ├── package.json
    ├── pnpm-lock.yaml
    ├── pnpm-workspace.yaml
    ├── readme.md
    ├── selene.toml
    ├── stylua.toml
    ├── testez.toml
    └── tsconfig.json
::
```