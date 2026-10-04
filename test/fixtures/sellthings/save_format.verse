# Persistable classes of SellThings (PlayerData/player_save.verse and records.verse) as published, for the round-trip tests.
player_saved<public> := class<final><persistable>:
    Version<public>:int = SaveVersion
    # Legacy int money (SaveVersion 1), read once by Load and never written again.
    Coins<public>:int = 0
    LuckLevel<public>:int = 0
    Inventory<public>:[]inventory_stack = array{}
    Mines<public>:[]placed_mine = array{}
    NextMineId<public>:int = 1
    UnlockedCells<public>:[]int = array{}
    CrateCount<public>:int = 0
    CrateValue<public>:int = 0
    DroneCount<public>:int = StartDrones
    DroneSpeedLevel<public>:int = 0
    Money<public>:float = 0.0
    CrateWorth<public>:float = 0.0
    PedestalLevel<public>:int = 0
    RegenLevel<public>:int = 0
    YieldLevel<public>:int = 0
    AutoRollLevel<public>:int = 0
    FurnaceLevel<public>:int = 0
    AutoRollOn<public>:logic = false
    # Legacy single boost pedestal, read once by Load when BoostOres is empty; still written as slot 0.
    BoostOre<public>:int = -1
    # GetSecondsSinceEpoch() of the last save, for offline earnings (0 = never saved).
    LastSeen<public>:float = 0.0
    OwnedPets<public>:[]owned_pet = array{}
    NextPetUid<public>:int = 1
    FuserBuilt<public>:logic = false
    BoostOres<public>:[]int = array{}
    TutorialStep<public>:int = 0

var SaveStore<public>:weak_map(player, player_saved) = map{}

inventory_stack<public> := class<final><persistable>:
    OreId<public>:int = 0
    Count<public>:int = 0

placed_mine<public> := class<final><persistable>:
    Id<public>:int = 0
    OreId<public>:int = 0
    X<public>:float = 0.0
    Y<public>:float = 0.0
    Turns<public>:int = 0
    # Ore level (+21.7% crate value each) and coating index into Mutations (0 = none).
    Level<public>:int = 0
    Mutation<public>:int = 0

owned_pet<public> := class<final><persistable>:
    Uid<public>:int = 0
    PetId<public>:int = 0
    # 0 normal, 1 gold, 2 rainbow (Balance.PetFusionFactors).
    Fusion<public>:int = 0
    Equipped<public>:logic = false
