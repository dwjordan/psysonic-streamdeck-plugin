import streamDeck from "@elgato/streamdeck";
import { NowPlaying } from "./actions/now-playing";
import { Skip } from "./actions/skip";

streamDeck.actions.registerAction(new NowPlaying());
streamDeck.actions.registerAction(new Skip());

streamDeck.connect();
