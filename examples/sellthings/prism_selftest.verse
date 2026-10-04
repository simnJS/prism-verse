using { /Verse.org/Simulation }
using { /Verse.org/SceneGraph }
using { /Fortnite.com/Game }
using { /Fortnite.com/Playspaces }
using { prism_demo_constants }

# Prints PASS/FAIL lines for the generated code: data checks at simulation start, then the size measurement, then
# store checks once a round starts.
names_case<public> := enum{LongEmpty, ShortEmpty, LongPlayed, ShortPlayed}

NamesNow<public>:float = 1760000000.0

prism_selftest_component<public> := class<final_super>(component):
    var Passed<private>:int = 0
    var Failed<private>:int = 0

    OnBeginSimulation<override>():void =
        (super:)OnBeginSimulation()
        CheckData()
        Report("data")
        spawn{MeasureFormats()}
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
        if (Played.UpsertMine[placed_mine{Id := Played.TakeNextMineId(), OreId := 2, X := 1234.5, Level := 3}]) {}
        Played.SetHeldOre(6)
        Rec := Played.ToRecord(1000.0)
        Reloaded := player_state{}
        Reloaded.LoadRecord(Rec)
        Expect("a list of a flat type is saved in columns", if (Rec.GetMinesId().Length = 1, Xs := Rec.GetMinesX(), Xs.Length = 1, X := Xs[0], X = 1234.5) then true else false)
        Expect("ToRecord then LoadRecord keeps every saved field", if (Reloaded.Coins = 120.5, Reloaded.LuckLevel = 4, Kept := Reloaded.Mines[0], Kept.X = 1234.5, Kept.Level = 3, Reloaded.NextMineId = 2, Rec.GetVersion() = 1, Rec.GetLastSeen() = 1000.0, Rec.GetSaveCount() = 1, Rec.GetFirstSeen() = 1000.0) then true else false)
        Expect("transient fields are not saved", if (Reloaded.HeldOre = -1) then true else false)

        Older := player_state_record{}.WithMinesId(array{4, 8}).WithMinesOreId(array{1, 2}).WithMinesLevel(array{6})
        Padded := player_state{}
        Padded.LoadRecord(Older)
        Expect("a column added later takes the field's default", if (Padded.Mines.Length = 2, Second := Padded.Mines[1], Second.Id = 8, Second.Level = 0, Second.X = 0.0) then true else false)

        Upgraded := wallet_record{}.WithVersion(1).WithLegacyCoins(40).PrismMigrated()
        Expect("an old save goes through its migration", if (Upgraded.GetVersion() = 2, Upgraded.GetCoins() = 40.0) then true else false)
        Current := wallet_record{}.WithVersion(2).WithLegacyCoins(40).WithCoins(9.0).PrismMigrated()
        Expect("a current save skips the migrations", if (Current.GetCoins() = 9.0) then true else false)

        Pointed := size_probe{}
        Pointed.SetOrigin(point{X := 1.5, Y := -2.5})
        Flat := Pointed.ToRecord(0.0)
        Back := size_probe{}
        Back.LoadRecord(Flat)
        Expect("a single flat type is saved as fields of the record", if (Flat.GetOriginX() = 1.5, Flat.GetOriginY() = -2.5, Back.Origin.X = 1.5, Back.Origin.Y = -2.5) then true else false)

        Numbers := player_state_record{}.WithLuckLevel(-3).WithDroneCount(0).WithCoins(-5.0).WithNextMineId(1)
        Stacks := Numbers.WithInventoryOreId(array{1, 99, 2}).WithInventoryCount(array{0, 2, 3}).WithBoostOres(array{3, 500})
        Broken := Stacks.WithMinesId(array{4, 8}).WithMinesOreId(array{1, 77}).WithMinesTurns(array{9, 0}).WithMinesMutation(array{42, 0})
        Loaded := player_state{}
        Loaded.LoadRecord(Broken)
        Expect("load clamps numbers", if (Loaded.LuckLevel = 0, Loaded.DroneCount = StartDrones, Loaded.Coins = 0.0) then true else false)
        Expect("load filters lists with @where", if (Loaded.Inventory.Length = 1, Loaded.Mines.Length = 1) then true else false)
        Expect("load validates the records inside lists", if (Kept := Loaded.Mines[0], Kept.Turns = 3, Kept.Mutation = 0) then true else false)
        Expect("load repairs id counters", if (Loaded.NextMineId = 5) then true else false)
        Expect("@valid replaces rejected items", if (Loaded.BoostOres.Length = 2, Rejected := Loaded.BoostOres[1], Rejected = -1) then true else false)

        Fresh := player_state{}
        Fresh.SetLuckLevel(-4)
        Fresh.SetPedestalLevel(99)
        Fresh.AddCoins(-1000000.0)
        Expect("setters clamp", if (Fresh.LuckLevel = 0, Fresh.PedestalLevel = MaxPedestalLevel, Fresh.Coins = 0.0) then true else false)
        Expect("setters mark the model dirty", if (Fresh.Dirty?) then true else false)
        for (Ore := 1..HotbarOreSlots):
            if (Fresh.PushInventory[inventory_stack{OreId := Ore, Count := 1}]) {}
        Expect("Push fails once @maxItems is reached", if (Fresh.Inventory.Length = HotbarOreSlots, not Fresh.PushInventory[inventory_stack{OreId := 1, Count := 1}]) then true else false)

        History := player_save{}
        for (Drop := 1..150):
            History.PushRecentDrop(Drop)
        Expect("a capped @trim(head) list drops its oldest item", if (History.RecentDrops.Length = 100, First := History.RecentDrops[0], First = 51) then true else false)

        Idle := player_state{}
        Idle.SetHeldOre(3)
        Expect("transient setters don't mark the model dirty", if (not Idle.Dirty?) then true else false)
        if (Idle.UpsertMine[placed_mine{Id := 1, OreId := 2}]) {}
        if (Idle.UpsertMine[placed_mine{Id := 1, OreId := 4}]) {}
        Expect("Upsert replaces by id", if (Idle.Mines.Length = 1, Found := Idle.FindMine[1], Found.OreId = 4) then true else false)
        Expect("Delete removes by id", if (Idle.DeleteMine[1], Idle.Mines.Length = 0) then true else false)
        Idle.Commit()
        Expect("Commit queues one write", if (Idle.TakeCommit[], not Idle.TakeCommit[]) then true else false)

        Rolled := player_state{}
        if (Rolled.SetCoins(10.0), Rolled.Commit(), Rolled.Coins > 100.0) {}
        Expect("a failed transaction cancels its changes and its Commit", if (Rolled.Coins = StartCoins, not Rolled.TakeCommit[]) then true else false)

        Newer := player_state{}
        Newer.LoadRecord(player_state_record{}.WithVersion(99))
        Expect("a save newer than the code is read-only", if (Newer.ReadOnly?) then true else false)

        Small := player_state_record{}
        Large := player_state_record{}.WithMinesId(for (Index := 1..300) { Index })
        Expect("PrismSize grows with the lists", if (Small.PrismSize() < PrismPlayerMapBudget, Large.PrismSize() >= Small.PrismSize() + 300 * 100) then true else false)

    # The real gain of columns: how many mines fit in one player map, as objects and as columns. One
    # FitsInPlayerMap per frame, on records of at most about 1.25 x the limit.
    MeasureFormats<private>()<suspends>:void =
        Rows := MostThatFit(false)
        Columns := MostThatFit(true)
        if (RowBytes := Quotient[262144, Rows], ColumnBytes := Quotient[262144, Columns]):
            Print("[prism selftest] measured: {Rows} mines fit as objects ({RowBytes} bytes each), {Columns} in columns ({ColumnBytes} bytes each), {1.0 * Columns / (1.0 * Rows)}x more")
        Expect("columns hold more mines than objects", if (Columns > Rows) then true else false)
        LongEmpty := RecordBytes(names_case.LongEmpty)
        ShortEmpty := RecordBytes(names_case.ShortEmpty)
        LongPlayed := RecordBytes(names_case.LongPlayed)
        ShortPlayed := RecordBytes(names_case.ShortPlayed)
        Print("[prism selftest] measured: the SellThings save takes {LongEmpty} bytes new and {LongPlayed} played with readable names, {ShortEmpty} and {ShortPlayed} with short names")
        Expect("short saved names make the record smaller", if (ShortEmpty < LongEmpty, ShortPlayed < LongPlayed) then true else false)
        Report("measure")

    MostThatFit<private>(Columns:logic)<suspends>:int =
        var Low:int = 0
        var High:int = 256
        loop:
            Grows := Fits(Columns, High)
            if (not Grows?):
                break
            set Low = High
            set High += Max(1, Quotient[High, 4] or 1)
            Sleep(0.0)
        loop:
            if (High - Low <= 1):
                break
            Sleep(0.0)
            Middle := Quotient[Low + High, 2] or Low
            Fit := Fits(Columns, Middle)
            if (Fit?):
                set Low = Middle
            else:
                set High = Middle
        Low

    Fits<private>(Columns:logic, Count:int):logic =
        Probe := size_probe{}
        if (Columns?):
            Probe.SetColumnMines(for (Id := 1..Count) { column_mine{Id := Id, OreId := 7, X := 1234.5, Y := -678.25, Turns := 1, Level := 12, Mutation := 2} })
        else:
            Probe.SetRowMines(for (Id := 1..Count) { row_mine{Id := Id, OreId := 7, X := 1234.5, Y := -678.25, Turns := 1, Level := 12, Mutation := 2} })
        Rec := Probe.ToRecord(0.0)
        if (FitsInPlayerMap[Rec]) then true else false

    # Bytes of a record in a player map: the limit minus the longest Pad that still fits (one byte per character), found
    # by bisection with one FitsInPlayerMap per frame.
    RecordBytes<private>(Case:names_case)<suspends>:int =
        var Low:int = 0
        var High:int = 262144
        loop:
            if (High - Low <= 1):
                break
            Sleep(0.0)
            Middle := Quotient[Low + High, 2] or Low
            Fit := PadFits(Case, Middle)
            if (Fit?):
                set Low = Middle
            else:
                set High = Middle
        262144 - Low

    PadFits<private>(Case:names_case, Length:int):logic =
        Pad:string = for (Index := 1..Length) { 'a' }
        case (Case):
            names_case.LongEmpty => if (FitsInPlayerMap[names_long{}.ToRecord(NamesNow).WithPad(Pad)]) then true else false
            names_case.ShortEmpty => if (FitsInPlayerMap[names_short{}.ToRecord(NamesNow).WithPad(Pad)]) then true else false
            names_case.LongPlayed => if (FitsInPlayerMap[PlayedLong().WithPad(Pad)]) then true else false
            names_case.ShortPlayed => if (FitsInPlayerMap[PlayedShort().WithPad(Pad)]) then true else false

    # A player well into the game: 300 mines, 40 pets, 8 stacks, 30 cells. The same data in both formats.
    PlayedLong<private>()<transacts>:names_long_record =
        Save := names_long{}
        Save.SetCoins(1234567.5)
        Save.SetLuckLevel(25)
        Save.SetPedestalLevel(6)
        Save.SetDroneCount(6)
        Save.SetAutoRollOn(true)
        Save.SetBoostOres(array{3, 7, 12})
        Save.SetInventory(for (Ore := 1..8) { long_stack{OreId := Ore, Count := 40 + Ore} })
        Save.SetMines(for (Id := 1..300) { long_mine{Id := Id, OreId := 7, X := 1000.5 + 1.0 * Id, Y := -678.25, Turns := 1, Level := 12, Mutation := 2} })
        Save.SetUnlockedCells(for (Cell := 1..30) { Cell })
        Save.SetOwnedPets(for (Uid := 1..40) { long_pet{Uid := Uid, PetId := 5, Fusion := 1, Equipped := if (Uid <= 3) then true else false} })
        Save.ToRecord(NamesNow)

    PlayedShort<private>()<transacts>:names_short_record =
        Save := names_short{}
        Save.SetCoins(1234567.5)
        Save.SetLuckLevel(25)
        Save.SetPedestalLevel(6)
        Save.SetDroneCount(6)
        Save.SetAutoRollOn(true)
        Save.SetBoostOres(array{3, 7, 12})
        Save.SetInventory(for (Ore := 1..8) { short_stack{OreId := Ore, Count := 40 + Ore} })
        Save.SetMines(for (Id := 1..300) { short_mine{Id := Id, OreId := 7, X := 1000.5 + 1.0 * Id, Y := -678.25, Turns := 1, Level := 12, Mutation := 2} })
        Save.SetUnlockedCells(for (Cell := 1..30) { Cell })
        Save.SetOwnedPets(for (Uid := 1..40) { short_pet{Uid := Uid, PetId := 5, Fusion := 1, Equipped := if (Uid <= 3) then true else false} })
        Save.ToRecord(NamesNow)

    # One group at a time, each in its own task, so every group reports before the final count.
    CheckStoresWhenReady<private>()<suspends>:void =
        if (Playspace := Entity.GetPlayspaceForEntity[], Who := Playspace.GetPlayers()[0]):
            Basics := spawn{CheckStoreBasics(Who)}
            Basics.Await()
            Sleep(0.0)
            Reload := spawn{CheckReload(Who)}
            Reload.Await()
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
        Expect("nothing is written before the first real change", if (not PlayerStateSaves[GetSession()][Who]) then true else false)
        State.SetCoins(77.0)
        PlayerStateStore.Pump(0.0)
        Expect("a change is written at the next pump", if (Saved := PlayerStateSaves[GetSession()][Who], Saved.GetCoins() = 77.0, not State.Dirty?) then true else false)
        State.AddCoins(1.0)
        State.Commit()
        PlayerStateStore.Pump(30.0)
        Expect("Commit writes even when writes are spaced out", if (Saved := PlayerStateSaves[GetSession()][Who], Saved.GetCoins() = 78.0) then true else false)
        State.AddCoins(1.0)
        PlayerStateStore.Pump(30.0)
        Expect("FlushSeconds spaces out the writes of a player", if (Saved := PlayerStateSaves[GetSession()][Who], Saved.GetCoins() = 78.0, State.Dirty?) then true else false)
        PlayerStateStore.Reset(Who)
        Expect("Reset gives a fresh player", if (State.Coins = StartCoins, State.Mines.Length = 0) then true else false)

    # Load, play, save, reload: the reloaded model has the same data.
    CheckReload<private>(Who:player)<suspends>:void =
        State := PlayerStateStore.Acquire(Who)
        State.SetCoins(4321.0)
        State.SetPedestalLevel(2)
        if (State.UpsertMine[placed_mine{Id := State.TakeNextMineId(), OreId := 3, X := 10.5, Y := -20.25, Turns := 1, Level := 4, Mutation := 2}]) {}
        if (State.UpsertOwnedPet[owned_pet{Uid := State.TakeNextPetUid(), PetId := 5, Fusion := 1, Equipped := true}]) {}
        if (State.PushUnlockedCell[3]) {}
        PlayerStateStore.Close(Who)
        Again := PlayerStateStore.Acquire(Who)
        Expect("a saved player reloads with the same data", if (Again.Coins = 4321.0, Again.PedestalLevel = 2, Mine := Again.Mines[0], Mine.X = 10.5, Mine.Y = -20.25, Mine.Level = 4, Mine.Mutation = 2, Pet := Again.OwnedPets[0], Pet.PetId = 5, Pet.Fusion = 1, Pet.Equipped?, Again.UnlockedCells.Length = 1, Again.SaveCount > 0) then true else false)

    # Above the PrismSize budget but small for real: one FitsInPlayerMap, nothing trimmed.
    CheckLargeRecord<private>(Who:player)<suspends>:void =
        Probe := SizeProbeStore.Acquire(Who)
        Probe.SetTrail(for (Step := 1..15000) { Step })
        SizeProbeStore.FlushNow(Who)
        Expect("a record over the budget that fits for real is written whole", if (Saved := SizeProbeSaves[GetSession()][Who], Saved.GetTrail().Length = 15000) then true else false)

    # Far above the limit: no FitsInPlayerMap at all, the @trim list is cut by arithmetic in one copy.
    CheckHugeRecord<private>(Who:player)<suspends>:void =
        Probe := SizeProbeStore.Acquire(Who)
        Probe.SetTrail(for (Step := 1..400000) { Step })
        SizeProbeStore.FlushNow(Who)
        if (Saved := SizeProbeSaves[GetSession()][Who], Trail := Saved.GetTrail(), Last := Trail[Trail.Length - 1]):
            Print("[prism selftest] Trail kept {Trail.Length} of 400000 items")
            Expect("a huge list is trimmed from the head, by arithmetic, to fit the budget", if (Trail.Length < 400000, Last = 400000, Saved.PrismSize() <= PrismPlayerMapBudget) then true else false)
        else:
            Expect("a huge list is trimmed from the head, by arithmetic, to fit the budget", false)
