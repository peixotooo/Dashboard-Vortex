export const WAPI_MESSAGE_TYPES = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "gif",
  "ptv",
  "location",
  "contact",
  "contacts",
  "button_actions",
  "buttons",
  "otp",
  "pix",
  "carousel",
  "list",
  "poll",
  "reaction",
  "remove_reaction",
] as const;

export type WapiMessageType = (typeof WAPI_MESSAGE_TYPES)[number];
export type WapiMessagePayload = Record<string, unknown>;

/**
 * Adapta o payload normalizado ao contrato HTTP da W-API.
 *
 * A W-API documenta pollMaxOptions como opcional e o exemplo de enquete de
 * escolha unica omite o campo. Na pratica, enviar explicitamente o valor 1
 * faz algumas instancias aceitarem a mensagem na fila sem publica-la no
 * WhatsApp. Para escolha unica, usamos portanto o default do provedor.
 */
export function toWapiWirePayload(
  messageType: WapiMessageType,
  payload: WapiMessagePayload,
): WapiMessagePayload {
  if (messageType !== "poll" || Number(payload.pollMaxOptions) !== 1) {
    return payload;
  }

  const { pollMaxOptions: _pollMaxOptions, ...wirePayload } = payload;
  return wirePayload;
}

export const WAPI_MESSAGE_TYPE_LABELS: Record<WapiMessageType, string> = {
  text: "Texto / link",
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  sticker: "Sticker",
  gif: "GIF",
  ptv: "Vídeo circular (PTV)",
  location: "Localização",
  contact: "Contato",
  contacts: "Vários contatos",
  button_actions: "Botões de ação",
  buttons: "Botões de resposta",
  otp: "Botão OTP",
  pix: "Botão PIX",
  carousel: "Carrossel",
  list: "Lista de opções",
  poll: "Enquete",
  reaction: "Reação",
  remove_reaction: "Remover reação",
};

export function isWapiMessageType(value: unknown): value is WapiMessageType {
  return (
    typeof value === "string" &&
    (WAPI_MESSAGE_TYPES as readonly string[]).includes(value)
  );
}

export function getDefaultWapiMessagePayload(
  messageType: WapiMessageType,
): WapiMessagePayload {
  switch (messageType) {
    case "contacts":
      return {
        contacts: [
          {
            contactName: "",
            contactPhone: "",
            contactBusinessDescription: "",
          },
        ],
      };
    case "button_actions":
      return {
        message: "",
        buttonActions: [{ type: "REPLAY", buttonText: "" }],
      };
    case "buttons":
      return {
        message: "",
        buttons: [{ buttonId: "button-1", label: "" }],
      };
    case "pix":
      return { merchantName: "", pixKey: "", type: "EVP" };
    case "poll":
      return { message: "", poll: ["", ""], pollMaxOptions: 1 };
    case "carousel":
      return {
        message: "",
        cards: [
          {
            text: "",
            image: "",
            buttonActions: [{ type: "REPLAY", buttonText: "" }],
          },
        ],
      };
    case "list":
      return {
        title: "",
        description: "",
        buttonText: "",
        footerText: "",
        sections: [
          {
            title: "",
            rows: [{ title: "", description: "", rowId: "option-1" }],
          },
        ],
      };
    default:
      return {};
  }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} deve ser um objeto.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  input: Record<string, unknown>,
  field: string,
  label = field,
): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} é obrigatório.`);
  }
  return value.trim();
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = input[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalMessageId(input: Record<string, unknown>) {
  const messageId = optionalString(input, "messageId");
  return messageId ? { messageId } : {};
}

function requireArray(
  input: Record<string, unknown>,
  field: string,
): unknown[] {
  const value = input[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} deve ter pelo menos um item.`);
  }
  return value;
}

export function normalizeWapiMessagePayload(
  messageType: WapiMessageType,
  rawPayload: unknown,
): WapiMessagePayload {
  const input = asRecord(rawPayload, "payload");
  const reply = optionalMessageId(input);

  switch (messageType) {
    case "text":
      return {
        message: requiredString(input, "message", "Mensagem"),
        ...reply,
      };
    case "image":
      return {
        image: requiredString(input, "image", "Imagem"),
        ...(optionalString(input, "caption")
          ? { caption: optionalString(input, "caption") }
          : {}),
        ...reply,
      };
    case "video":
      return {
        video: requiredString(input, "video", "Vídeo"),
        ...(optionalString(input, "caption")
          ? { caption: optionalString(input, "caption") }
          : {}),
        ...reply,
      };
    case "audio":
      return { audio: requiredString(input, "audio", "Áudio"), ...reply };
    case "document":
      return {
        document: requiredString(input, "document", "Documento"),
        extension: requiredString(input, "extension", "Extensão"),
        ...(optionalString(input, "fileName")
          ? { fileName: optionalString(input, "fileName") }
          : {}),
        ...(optionalString(input, "caption")
          ? { caption: optionalString(input, "caption") }
          : {}),
        ...reply,
      };
    case "sticker":
      return { sticker: requiredString(input, "sticker", "Sticker"), ...reply };
    case "gif":
      return {
        gif: requiredString(input, "gif", "GIF em MP4"),
        ...(optionalString(input, "caption")
          ? { caption: optionalString(input, "caption") }
          : {}),
        ...reply,
      };
    case "ptv":
      return { ptv: requiredString(input, "ptv", "Vídeo PTV"), ...reply };
    case "location": {
      const latitude = requiredString(input, "latitude", "Latitude");
      const longitude = requiredString(input, "longitude", "Longitude");
      if (
        !Number.isFinite(Number(latitude)) ||
        !Number.isFinite(Number(longitude))
      ) {
        throw new Error("Latitude e longitude precisam ser números válidos.");
      }
      return {
        name: requiredString(input, "name", "Nome do local"),
        address: requiredString(input, "address", "Endereço"),
        latitude,
        longitude,
        ...reply,
      };
    }
    case "contact":
      return {
        contactName: requiredString(input, "contactName", "Nome do contato"),
        contactPhone: requiredString(
          input,
          "contactPhone",
          "Telefone do contato",
        ),
        ...(optionalString(input, "contactBusinessDescription")
          ? {
              contactBusinessDescription: optionalString(
                input,
                "contactBusinessDescription",
              ),
            }
          : {}),
        ...reply,
      };
    case "contacts": {
      const contacts = requireArray(input, "contacts").map((item, index) => {
        const contact = asRecord(item, `contacts[${index}]`);
        return {
          contactName: requiredString(
            contact,
            "contactName",
            `Nome do contato ${index + 1}`,
          ),
          contactPhone: requiredString(
            contact,
            "contactPhone",
            `Telefone do contato ${index + 1}`,
          ),
          ...(optionalString(contact, "contactBusinessDescription")
            ? {
                contactBusinessDescription: optionalString(
                  contact,
                  "contactBusinessDescription",
                ),
              }
            : {}),
        };
      });
      return { contacts, ...reply };
    }
    case "button_actions": {
      const buttonActions = requireArray(input, "buttonActions").map(
        (item, index) => {
          const action = asRecord(item, `buttonActions[${index}]`);
          const type = requiredString(
            action,
            "type",
            "Tipo do botão",
          ).toUpperCase();
          if (!["CALL", "URL", "REPLAY"].includes(type)) {
            throw new Error("Botões de ação aceitam CALL, URL ou REPLAY.");
          }
          return {
            type,
            buttonText: requiredString(action, "buttonText", "Texto do botão"),
            ...(type === "CALL"
              ? { phone: requiredString(action, "phone", "Telefone do botão") }
              : {}),
            ...(type === "URL"
              ? { url: requiredString(action, "url", "URL do botão") }
              : {}),
          };
        },
      );
      return {
        message: requiredString(input, "message", "Mensagem"),
        buttonActions,
      };
    }
    case "buttons": {
      const buttons = requireArray(input, "buttons").map((item, index) => {
        const button = asRecord(item, `buttons[${index}]`);
        return {
          buttonId: requiredString(button, "buttonId", "ID do botão"),
          label: requiredString(button, "label", "Texto do botão"),
        };
      });
      return { message: requiredString(input, "message", "Mensagem"), buttons };
    }
    case "otp":
      return {
        message: requiredString(input, "message", "Mensagem"),
        buttonText: requiredString(input, "buttonText", "Texto do botão"),
        code: requiredString(input, "code", "Código"),
      };
    case "pix": {
      const type = requiredString(
        input,
        "type",
        "Tipo da chave PIX",
      ).toUpperCase();
      if (!["CPF", "CNPJ", "PHONE", "EMAIL", "EVP"].includes(type)) {
        throw new Error(
          "Tipo PIX inválido. Use CPF, CNPJ, PHONE, EMAIL ou EVP.",
        );
      }
      return {
        merchantName: requiredString(input, "merchantName", "Título do PIX"),
        pixKey: requiredString(input, "pixKey", "Chave PIX"),
        type,
      };
    }
    case "carousel": {
      const cards = requireArray(input, "cards").map((item, cardIndex) => {
        const card = asRecord(item, `cards[${cardIndex}]`);
        const buttonActions = requireArray(card, "buttonActions").map(
          (button, buttonIndex) => {
            const action = asRecord(
              button,
              `cards[${cardIndex}].buttonActions[${buttonIndex}]`,
            );
            const type = requiredString(
              action,
              "type",
              "Tipo do botão",
            ).toUpperCase();
            if (!["CALL", "URL", "REPLAY"].includes(type)) {
              throw new Error(
                "Botões do carrossel aceitam CALL, URL ou REPLAY.",
              );
            }
            return {
              type,
              buttonText: requiredString(
                action,
                "buttonText",
                "Texto do botão",
              ),
              ...(type === "CALL"
                ? {
                    phone: requiredString(action, "phone", "Telefone do botão"),
                  }
                : {}),
              ...(type === "URL"
                ? { url: requiredString(action, "url", "URL do botão") }
                : {}),
            };
          },
        );
        return {
          text: requiredString(card, "text", "Texto do cartão"),
          image: requiredString(card, "image", "Imagem do cartão"),
          buttonActions,
        };
      });
      return { message: requiredString(input, "message", "Mensagem"), cards };
    }
    case "list": {
      const sections = requireArray(input, "sections").map(
        (item, sectionIndex) => {
          const section = asRecord(item, `sections[${sectionIndex}]`);
          const rows = requireArray(section, "rows").map(
            (rowItem, rowIndex) => {
              const row = asRecord(rowItem, `rows[${rowIndex}]`);
              return {
                title: requiredString(row, "title", "Título da opção"),
                description: requiredString(
                  row,
                  "description",
                  "Descrição da opção",
                ),
                rowId: requiredString(row, "rowId", "ID da opção"),
              };
            },
          );
          return {
            title: requiredString(section, "title", "Título da seção"),
            rows,
          };
        },
      );
      return {
        title: requiredString(input, "title", "Título"),
        description: requiredString(input, "description", "Descrição"),
        buttonText: requiredString(input, "buttonText", "Texto do botão"),
        footerText: requiredString(input, "footerText", "Rodapé"),
        sections,
      };
    }
    case "poll": {
      const poll = requireArray(input, "poll").map((item) => {
        if (typeof item !== "string" || !item.trim()) {
          throw new Error("Todas as opções da enquete precisam de texto.");
        }
        return item.trim();
      });
      if (poll.length < 2)
        throw new Error("A enquete precisa de pelo menos 2 opções.");
      const rawMax = input.pollMaxOptions;
      const pollMaxOptions =
        typeof rawMax === "number" && Number.isInteger(rawMax)
          ? rawMax
          : Number(rawMax || 1);
      if (pollMaxOptions < 1 || pollMaxOptions > poll.length) {
        throw new Error("Máximo de escolhas da enquete inválido.");
      }
      return {
        message: requiredString(input, "message", "Pergunta"),
        poll,
        pollMaxOptions,
      };
    }
    case "reaction":
      return {
        reaction: requiredString(input, "reaction", "Emoji da reação"),
        messageId: requiredString(input, "messageId", "ID da mensagem"),
      };
    case "remove_reaction":
      return {
        messageId: requiredString(input, "messageId", "ID da mensagem"),
      };
  }
}

export function getWapiPayloadSummary(
  messageType: WapiMessageType,
  payload: WapiMessagePayload,
): string | null {
  const firstString = (...fields: string[]) => {
    for (const field of fields) {
      const value = payload[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };

  if (messageType === "poll") return firstString("message");
  if (messageType === "location") {
    return [firstString("name"), firstString("address")]
      .filter(Boolean)
      .join(" — ");
  }
  if (messageType === "contact")
    return firstString("contactName", "contactPhone");
  if (messageType === "contacts") {
    const count = Array.isArray(payload.contacts) ? payload.contacts.length : 0;
    return `${count} contato(s)`;
  }
  if (messageType === "pix") return firstString("merchantName", "pixKey");
  if (messageType === "reaction") return firstString("reaction", "messageId");
  if (messageType === "remove_reaction") return firstString("messageId");
  return firstString("message", "caption", "fileName", "title");
}
