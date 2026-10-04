using { /Fortnite.com/Devices }
using { /Fortnite.com/Game }
using { /Fortnite.com/Playspaces }
using { /Verse.org/SceneGraph }
using { /Verse.org/Simulation }
using { Lib.Prism }

save_device := class(creative_device):
    OnBegin<override>()<suspends>:void =
        prism_runner{Stores := array{PlayerSaveStore}}.Run(GetPlayspace())

save_component := class<final_super>(component):
    OnBeginSimulation<override>():void =
        (super:)OnBeginSimulation()
        if (RoundManager := Entity.GetFortRoundManager[]):
            RoundManager.SubscribeRoundStarted(RunRound)

    RunRound()<suspends>:void =
        if (Playspace := Entity.GetPlayspaceForEntity[]):
            prism_runner{Stores := array{PlayerSaveStore}}.Run(Playspace)

ReadmeUsage(Player:player):void =
    if (Save := Player.GetPlayerSave[]):
        Save.AddCoins(25.0)
        Uid := Save.TakeNextCard()
        if (Save.UpsertCard[card{Uid := Uid, Kind := 3}]):
            Save.Commit()

WatchCoins(Save:player_save)<suspends>:void =
    loop:
        Field := Save.FieldChanged.Await()
        if (Field = player_save_field.Coins):
            Print("Coins: {Save.Coins}")

WatchBlockedSaves(Save:player_save)<suspends>:void =
    loop:
        Reason := Save.SaveBlocked.Await()
        if (Reason = prism_block.TooLarge):
            Print("This save no longer fits in the player map")
