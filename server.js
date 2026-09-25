const express = require("express");
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 10000;

/*
  Salas ativas.

  Estrutura:

  campaigns = {
    ABC123: {
      code: "ABC123",
      name: "Minha campanha",
      master: {...},
      players: {...},
      characters: {...}
    }
  }
*/

const campaigns = new Map();

app.get("/", (req, res) => {
  res.json({
    ok: true,
    game: "A Caçada",
    server: "online",
    campaigns: campaigns.size
  });
});

function generateCode() {
  let code;

  do {
    code = crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();
  } while (campaigns.has(code));

  return code;
}

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(campaign, message) {
  send(campaign.master.socket, message);

  for (const player of Object.values(campaign.players)) {
    send(player.socket, message);
  }
}

function publicCampaign(campaign) {
  return {
    code: campaign.code,
    name: campaign.name,
    master: {
      id: campaign.master.id,
      name: campaign.master.name
    },
    players: Object.values(campaign.players).map(player => ({
      id: player.id,
      name: player.name
    })),
    characters: Object.values(campaign.characters).map(character => {
      const copy = { ...character };
      delete copy.socket;
      return copy;
    })
  };
}

function createCampaign(name, ws) {
  const code = generateCode();

  const masterId = crypto.randomUUID();

  const campaign = {
    code,
    name: name || "A Caçada — Nova Campanha",

    master: {
      id: masterId,
      name: "Mestre",
      socket: ws
    },

    players: {},

    characters: {}
  };

  campaigns.set(code, campaign);

  ws.campaignCode = code;
  ws.userId = masterId;
  ws.role = "master";

  send(ws, {
    type: "campaign_created",
    campaign: publicCampaign(campaign)
  });
}

function joinCampaign(code, playerName, ws) {
  const campaign = campaigns.get(code);

  if (!campaign) {
    return send(ws, {
      type: "error",
      message: "Campanha não encontrada."
    });
  }

  const playerId = crypto.randomUUID();

  campaign.players[playerId] = {
    id: playerId,
    name: playerName || "Jogador",
    socket: ws
  };

  ws.campaignCode = code;
  ws.userId = playerId;
  ws.role = "player";

  send(ws, {
    type: "joined_campaign",
    campaign: publicCampaign(campaign)
  });

  broadcast(campaign, {
    type: "campaign_updated",
    campaign: publicCampaign(campaign)
  });
}

function saveCharacter(ws, character) {
  const code = ws.campaignCode;

  if (!code) {
    return send(ws, {
      type: "error",
      message: "Você não está em uma campanha."
    });
  }

  const campaign = campaigns.get(code);

  if (!campaign) {
    return send(ws, {
      type: "error",
      message: "Campanha não encontrada."
    });
  }

  if (!character || !character.id) {
    return send(ws, {
      type: "error",
      message: "Ficha inválida."
    });
  }

  campaign.characters[character.id] = {
    ...character,
    ownerId: ws.userId
  };

  broadcast(campaign, {
    type: "character_updated",
    character: campaign.characters[character.id]
  });
}

function deleteCharacter(ws, characterId) {
  const code = ws.campaignCode;

  if (!code) return;

  const campaign = campaigns.get(code);

  if (!campaign) return;

  const character = campaign.characters[characterId];

  if (!character) return;

  /*
    O mestre pode apagar qualquer ficha.
    O jogador só pode apagar a própria ficha.
  */

  if (
    ws.role !== "master" &&
    character.ownerId !== ws.userId
  ) {
    return send(ws, {
      type: "error",
      message: "Você não pode apagar esta ficha."
    });
  }

  delete campaign.characters[characterId];

  broadcast(campaign, {
    type: "character_deleted",
    characterId
  });
}

wss.on("connection", ws => {
  console.log("Cliente conectado.");

  send(ws, {
    type: "connected"
  });

  ws.on("message", raw => {
    try {
      const message = JSON.parse(raw.toString());

      switch (message.type) {

        case "create_campaign":
          createCampaign(message.name, ws);
          break;

        case "join_campaign":
          joinCampaign(
            String(message.code || "").toUpperCase(),
            message.playerName,
            ws
          );
          break;

        case "save_character":
          saveCharacter(ws, message.character);
          break;

        case "delete_character":
          deleteCharacter(ws, message.characterId);
          break;

        case "get_campaign": {
          const campaign = campaigns.get(ws.campaignCode);

          if (!campaign) {
            return send(ws, {
              type: "error",
              message: "Campanha não encontrada."
            });
          }

          send(ws, {
            type: "campaign_updated",
            campaign: publicCampaign(campaign)
          });

          break;
        }

        default:
          send(ws, {
            type: "error",
            message: "Comando desconhecido."
          });
      }

    } catch (error) {
      console.error(error);

      send(ws, {
        type: "error",
        message: "Mensagem inválida."
      });
    }
  });

  ws.on("close", () => {
    console.log("Cliente desconectado.");

    const code = ws.campaignCode;

    if (!code) return;

    const campaign = campaigns.get(code);

    if (!campaign) return;

    if (ws.role === "master") {
      /*
        Por enquanto, se o mestre sair,
        a sala é encerrada.
      */
      campaigns.delete(code);

      console.log(
        `Campanha ${code} encerrada porque o mestre saiu.`
      );

      return;
    }

    if (campaign.players[ws.userId]) {
      delete campaign.players[ws.userId];

      broadcast(campaign, {
        type: "campaign_updated",
        campaign: publicCampaign(campaign)
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`A Caçada Server rodando na porta ${PORT}`);
});
