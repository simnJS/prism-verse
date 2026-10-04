using { /Verse.org/Simulation }
using { /Verse.org/SceneGraph }
using { /Fortnite.com/Game }
using { /Fortnite.com/Playspaces }
using { prism_demo_constants }

# Prints PASS/FAIL lines for the generated code: data checks at simulation start, store checks once a round starts.
prism_selftest_component<public> := class<final_super>(component):
    var Passed<private>:int = 0
    var Failed<private>:int = 0

    OnBeginSimulation<override>():void =
        (super:)OnBeginSimulation()
        CheckData()
        Report("data")
        if (RM := Entity.GetFortRoundManager[]):
            RM.SubscribeRoundStarted(CheckStoresWhenReady)

    Expect<private>(Name:string, Ok:logic):void =
        if (Ok?):
            set Passed += 1
            Print("[prism selftest] PASS {Name}")
        else:
            set Failed += 1
            Print("[prism selftest] FAIL {Name}")

    Report<private>(Phase:string):void =
        Print("[prism selftest] {Phase}: {Passed} passed, {Failed} failed")

    CheckData<private>():void =
        Mine := placed_mine{Id := 5, OreId := 3, Turns := 2}
        Leveled := Mine.WithLevel(7)
        Expect("With* replaces one field and keeps the others", if (Leveled.Level = 7, Leveled.Id = 5, Leveled.OreId = 3, Leveled.Turns = 2) then true else false)

        Played := player_state{}
        Played.SetCoins(120.5)
        Played.SetLuckLevel(4)
        Played.UpsertMine(placed_mine{Id := Played.TakeNextMineId(), OreId := 2, Level := 3})
        Played.SetHeldOre(6)
        Rec := Played.ToRecord(1000.0)
        Reloaded := player_state{}
        Reloaded.LoadRecord(Rec)
        Expect("ToRecord then LoadRecord keeps every saved field", if (Reloaded.Coins = 120.5, Reloaded.LuckLevel = 4, Reloaded.Mines.Length = 1, Reloaded.NextMineId = 2, Rec.Money = 120.5, Rec.Version = 3, Rec.LastSeen = 1000.0) then true else false)
        Expect("transient fields are not saved", if (Reloaded.HeldOre = -1) then true else false)

        Upgraded := player_saved{Version := 1, Coins := 40, CrateValue := 7, BoostOre := 5}.PrismMigrated()
        Expect("a v1 save migrates int money to float", if (Upgraded.Version = 3, Upgraded.Money = 40.0, Upgraded.CrateWorth = 7.0) then true else false)
        Expect("a v2 save moves its single boost ore into BoostOres", if (Upgraded.BoostOres.Length = 1, Only := Upgraded.BoostOres[0], Only = 5) then true else false)
        Current := player_saved{Version := 3, Money := 9.0, BoostOres := array{1, 2}}.PrismMigrated()
        Expect("a current save skips the migrations", if (Current.Money = 9.0, Current.BoostOres.Length = 2) then true else false)

        Broken := player_saved:
            Version := 3
            LuckLevel := -3
            DroneCount := 0
            Money := -5.0
            Inventory := array{inventory_stack{OreId := 1, Count := 0}, inventory_stack{OreId := 99, Count := 2}, inventory_stack{OreId := 2, Count := 3}}
            Mines := array{placed_mine{Id := 4, OreId := 1, Turns := 9, Mutation := 42}, placed_mine{Id := 8, OreId := 77}}
            NextMineId := 1
            BoostOres := array{3, 500}
        Loaded := player_state{}
        Loaded.LoadRecord(Broken)
        Expect("load clamps numbers", if (Loaded.LuckLevel = 0, Loaded.DroneCount = StartDrones, Loaded.Coins = 0.0) then true else false)
        Expect("load filters lists with @where", if (Loaded.Inventory.Length = 1, Loaded.Mines.Length = 1) then true else false)
        Expect("load validates the records inside lists", if (Kept := Loaded.Mines[0], Kept.Turns = 3, Kept.Mutation = 0) then true else false)
        Expect("load repairs id counters", if (Loaded.NextMineId = 5) then true else false)
        Expect("@valid replaces rejected items", if (Loaded.BoostOres.Length = 2, Rejected := Loaded.BoostOres[1], Rejected = -1) then true else false)

        Fresh := player_state{}
        Fresh.SetLuckLevel(999)
        Fresh.AddCoins(-1000000.0)
        Expect("setters clamp", if (Fresh.LuckLevel = MaxUpgradeLevel, Fresh.Coins = 0.0) then true else false)
        Expect("setters mark the model dirty", if (Fresh.Dirty?) then true else false)
        for (Ore := 1..HotbarOreSlots):
            if (Fresh.PushInventory[inventory_stack{OreId := Ore, Count := 1}]) {}
        Expect("Push fails once @maxItems is reached", if (Fresh.Inventory.Length = HotbarOreSlots, not Fresh.PushInventory[inventory_stack{OreId := 1, Count := 1}]) then true else false)

        Idle := player_state{}
        Idle.SetHeldOre(3)
        Expect("transient setters don't mark the model dirty", if (not Idle.Dirty?) then true else false)
        Idle.UpsertMine(placed_mine{Id := 1, OreId := 2})
        Idle.UpsertMine(placed_mine{Id := 1, OreId := 4})
        Expect("Upsert replaces by id", if (Idle.Mines.Length = 1, Found := Idle.FindMine[1], Found.OreId = 4) then true else false)
        Expect("Delete removes by id", if (Idle.DeleteMine[1], Idle.Mines.Length = 0) then true else false)
        Idle.Commit()
        Expect("Commit queues one write", if (Idle.TakeCommit[], not Idle.TakeCommit[]) then true else false)

        Rolled := player_state{}
        if (Rolled.SetCoins(10.0), Rolled.Commit(), Rolled.Coins > 100.0) {}
        Expect("a failed transaction cancels its changes and its Commit", if (Rolled.Coins = StartCoins, not Rolled.TakeCommit[]) then true else false)

        Newer := player_state{}
        Newer.LoadRecord(player_saved{Version := 99})
        Expect("a save newer than the code is read-only", if (Newer.ReadOnly?) then true else false)

        Small := player_saved{}
        Large := player_saved{Mines := for (Index := 1..300) { placed_mine{Id := Index} }}
        Expect("PrismSize grows with the lists", if (Small.PrismSize() < PrismPlayerMapBudget, Large.PrismSize() >= Small.PrismSize() + 300 * 300) then true else false)

    # One group at a time, each in its own task, so every group reports before the final count.
    CheckStoresWhenReady<private>()<suspends>:void =
        if (Playspace := Entity.GetPlayspaceForEntity[], Who := Playspace.GetPlayers()[0]):
            Basics := spawn{CheckStoreBasics(Who)}
            Basics.Await()
            Sleep(0.0)
            Large := spawn{CheckLargeRecord(Who)}
            Large.Await()
            Sleep(0.0)
            Huge := spawn{CheckHugeRecord(Who)}
            Huge.Await()
            Sleep(0.0)
        else:
            Print("[prism selftest] store checks skipped: no player")
        Report("all")

    CheckStoreBasics<private>(Who:player)<suspends>:void =
        State := PlayerStateStore.Acquire(Who)
        State.SetHeldOre(9)
        Expect("Acquire caches the model", if (Cached := Who.GetPlayerState[], Cached.HeldOre = 9) then true else false)
        PlayerStateStore.FlushNow(Who)
        Expect("nothing is written before the first real change", if (not SaveStore[GetSession()][Who]) then true else false)
        State.SetCoins(77.0)
        PlayerStateStore.Pump(0.0)
        Expect("a change is written at the next pump", if (Saved := SaveStore[GetSession()][Who], Saved.Money = 77.0, not State.Dirty?) then true else false)
        State.AddCoins(1.0)
        State.Commit()
        PlayerStateStore.Pump(30.0)
        Expect("Commit writes even when writes are spaced out", if (Saved := SaveStore[GetSession()][Who], Saved.Money = 78.0) then true else false)
        State.AddCoins(1.0)
        PlayerStateStore.Pump(30.0)
        Expect("FlushSeconds spaces out the writes of a player", if (Saved := SaveStore[GetSession()][Who], Saved.Money = 78.0, State.Dirty?) then true else false)
        PlayerStateStore.Reset(Who)
        Expect("Reset gives a fresh player", if (State.Coins = StartCoins, State.Mines.Length = 0) then true else false)

    # Above the PrismSize budget but small for real: one FitsInPlayerMap, nothing trimmed.
    CheckLargeRecord<private>(Who:player)<suspends>:void =
        Save := PlayerSaveStore.Acquire(Who)
        Save.SetRecentDrops(for (Drop := 1..15000) { Drop })
        PlayerSaveStore.FlushNow(Who)
        Expect("a record over the budget that fits for real is written whole", if (Saved := PlayerSaveSaves[GetSession()][Who], Saved.RecentDrops.Length = 15000) then true else false)

    # Far above the limit: no FitsInPlayerMap at all, the @trim list is cut by arithmetic in one copy.
    CheckHugeRecord<private>(Who:player)<suspends>:void =
        Save := PlayerSaveStore.Acquire(Who)
        Save.SetRecentDrops(for (Drop := 1..400000) { Drop })
        PlayerSaveStore.FlushNow(Who)
        if (Saved := PlayerSaveSaves[GetSession()][Who], Last := Saved.RecentDrops[Saved.RecentDrops.Length - 1]):
            Print("[prism selftest] RecentDrops kept {Saved.RecentDrops.Length} of 400000 items")
            Expect("a huge list is trimmed from the head, by arithmetic, to fit the budget", if (Saved.RecentDrops.Length < 400000, Last = 400000, Saved.PrismSize() <= PrismPlayerMapBudget) then true else false)
        else:
            Expect("a huge list is trimmed from the head, by arithmetic, to fit the budget", false)
