using { /Verse.org/Simulation }

IsKnownOre(It:int)<computes><decides>:void =
    It >= 0
    It < 15

IsKnownMutation(It:int)<computes><decides>:void =
    It >= 0
    It <= 4

IsValidStack(It:inventory_stack)<computes><decides>:void =
    It.Count > 0
    IsKnownOre[It.OreId]

IsKnownMine(It:placed_mine)<computes><decides>:void =
    IsKnownOre[It.OreId]

IsKnownPet(It:owned_pet)<computes><decides>:void =
    It.PetId >= 0
    It.PetId < 12

AfterLoad(Who:player, State:player_state):void =
    Away := Min(State.OfflineSeconds, 8.0 * 3600.0)
    if (Away >= 60.0):
        State.AddCoins(Away * 0.1)
    if (State.BoostOres.Length = 0):
        State.SetBoostOres(array{-1})
