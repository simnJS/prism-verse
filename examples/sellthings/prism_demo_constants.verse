# Stand-ins for SellThings' Balance values, in their own module: a persisted default can't name a constant of its own module.
prism_demo_constants<public> := module:
    SaveVersion<public>:int = 2
    StartDrones<public>:int = 1
    StartCoins<public>:float = 25.0
    MaxDrones<public>:int = 8
    DroneMaxSpeedLevel<public>:int = 10
    MaxUpgradeLevel<public>:int = 25
    HotbarOreSlots<public>:int = 6
    MaxOreLevel<public>:int = 20
    MaxPetFusion<public>:int = 2
    MaxStoredPets<public>:int = 50
    MaxBoostPedestals<public>:int = 3
    TutorialSteps<public>:int = 7
