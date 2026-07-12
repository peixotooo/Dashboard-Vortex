"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  WapiMessagePayload,
  WapiMessageType,
} from "@/lib/whatsapp/wapi-message-types";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  messageType: WapiMessageType;
  value: WapiMessagePayload;
  onChange: (value: WapiMessagePayload) => void;
}

type Item = Record<string, unknown>;

const emptyContact = () => ({
  contactName: "",
  contactPhone: "",
  contactBusinessDescription: "",
});
const emptyAction = () => ({ type: "REPLAY", buttonText: "" });
const emptyButton = () => ({ buttonId: "button-1", label: "" });
const emptyCard = () => ({
  text: "",
  image: "",
  buttonActions: [emptyAction()],
});
const emptyRow = () => ({
  title: "",
  description: "",
  rowId: "option-1",
});
const emptySection = () => ({ title: "", rows: [emptyRow()] });

export function RichMessageFields({ messageType, value, onChange }: Props) {
  const set = (field: string, next: unknown) =>
    onChange({ ...value, [field]: next });

  const getArray = (field: string, fallback: Item): Item[] => {
    const items = value[field];
    return Array.isArray(items) && items.length > 0
      ? (items as Item[])
      : [fallback];
  };

  const setArrayItem = (
    field: string,
    index: number,
    patch: Record<string, unknown>,
    fallback: Item,
  ) => {
    const items = [...getArray(field, fallback)];
    items[index] = { ...items[index], ...patch };
    set(field, items);
  };

  const removeArrayItem = (field: string, index: number, fallback: Item) => {
    const items = getArray(field, fallback).filter((_, i) => i !== index);
    set(field, items.length > 0 ? items : [fallback]);
  };

  if (
    messageType === "sticker" ||
    messageType === "gif" ||
    messageType === "ptv"
  ) {
    const field = messageType;
    return (
      <div className="space-y-4">
        <div>
          <Label>
            {messageType === "sticker"
              ? "URL ou Base64 do sticker"
              : messageType === "gif"
                ? "URL ou Base64 do GIF (arquivo MP4)"
                : "URL ou Base64 do vídeo circular (MP4)"}
          </Label>
          <Input
            value={String(value[field] || "")}
            onChange={(event) => set(field, event.target.value)}
            placeholder="https://..."
          />
          {messageType === "sticker" && (
            <p className="mt-1 text-xs text-muted-foreground">
              PNG, JPEG, WEBP ou GIF, preferencialmente 512×512.
            </p>
          )}
        </div>
        {messageType === "gif" && (
          <div>
            <Label>Legenda (opcional)</Label>
            <Textarea
              value={String(value.caption || "")}
              onChange={(event) => set("caption", event.target.value)}
              rows={2}
            />
          </div>
        )}
      </div>
    );
  }

  if (messageType === "location") {
    return (
      <div className="space-y-4">
        <div>
          <Label>Nome do local</Label>
          <Input
            value={String(value.name || "")}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Academia West Select"
          />
        </div>
        <div>
          <Label>Endereço</Label>
          <Input
            value={String(value.address || "")}
            onChange={(event) => set("address", event.target.value)}
            placeholder="Rua, número, bairro, cidade"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Latitude</Label>
            <Input
              value={String(value.latitude || "")}
              onChange={(event) => set("latitude", event.target.value)}
              placeholder="-16.6869"
            />
          </div>
          <div>
            <Label>Longitude</Label>
            <Input
              value={String(value.longitude || "")}
              onChange={(event) => set("longitude", event.target.value)}
              placeholder="-49.2648"
            />
          </div>
        </div>
      </div>
    );
  }

  if (messageType === "contact") {
    return (
      <ContactFields
        value={value}
        onChange={(patch) => onChange({ ...value, ...patch })}
      />
    );
  }

  if (messageType === "contacts") {
    const contacts = getArray("contacts", emptyContact());
    return (
      <ArrayEditor
        title="Contatos"
        addLabel="Adicionar contato"
        onAdd={() => set("contacts", [...contacts, emptyContact()])}
      >
        {contacts.map((contact, index) => (
          <EditorCard
            key={index}
            title={`Contato ${index + 1}`}
            onRemove={() => removeArrayItem("contacts", index, emptyContact())}
          >
            <ContactFields
              value={contact}
              onChange={(patch) =>
                setArrayItem("contacts", index, patch, emptyContact())
              }
            />
          </EditorCard>
        ))}
      </ArrayEditor>
    );
  }

  if (messageType === "button_actions") {
    const actions = getArray("buttonActions", emptyAction());
    return (
      <div className="space-y-4">
        <MessageField value={value} onChange={set} />
        <ArrayEditor
          title="Botões"
          addLabel="Adicionar botão"
          onAdd={() => set("buttonActions", [...actions, emptyAction()])}
        >
          {actions.map((action, index) => (
            <EditorCard
              key={index}
              title={`Botão ${index + 1}`}
              onRemove={() =>
                removeArrayItem("buttonActions", index, emptyAction())
              }
            >
              <ActionFields
                value={action}
                onChange={(patch) =>
                  setArrayItem("buttonActions", index, patch, emptyAction())
                }
              />
            </EditorCard>
          ))}
        </ArrayEditor>
      </div>
    );
  }

  if (messageType === "buttons") {
    const buttons = getArray("buttons", emptyButton());
    return (
      <div className="space-y-4">
        <MessageField value={value} onChange={set} />
        <ArrayEditor
          title="Botões de resposta"
          addLabel="Adicionar botão"
          onAdd={() =>
            set("buttons", [
              ...buttons,
              { buttonId: `button-${buttons.length + 1}`, label: "" },
            ])
          }
        >
          {buttons.map((button, index) => (
            <EditorCard
              key={index}
              title={`Botão ${index + 1}`}
              onRemove={() => removeArrayItem("buttons", index, emptyButton())}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>ID</Label>
                  <Input
                    value={String(button.buttonId || "")}
                    onChange={(event) =>
                      setArrayItem(
                        "buttons",
                        index,
                        { buttonId: event.target.value },
                        emptyButton(),
                      )
                    }
                  />
                </div>
                <div>
                  <Label>Texto</Label>
                  <Input
                    value={String(button.label || "")}
                    onChange={(event) =>
                      setArrayItem(
                        "buttons",
                        index,
                        { label: event.target.value },
                        emptyButton(),
                      )
                    }
                  />
                </div>
              </div>
            </EditorCard>
          ))}
        </ArrayEditor>
      </div>
    );
  }

  if (messageType === "otp") {
    return (
      <div className="space-y-4">
        <MessageField value={value} onChange={set} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Texto do botão</Label>
            <Input
              value={String(value.buttonText || "")}
              onChange={(event) => set("buttonText", event.target.value)}
              placeholder="Copiar código"
            />
          </div>
          <div>
            <Label>Código</Label>
            <Input
              value={String(value.code || "")}
              onChange={(event) => set("code", event.target.value)}
              placeholder="123456"
            />
          </div>
        </div>
      </div>
    );
  }

  if (messageType === "pix") {
    return (
      <div className="space-y-4">
        <div>
          <Label>Título exibido</Label>
          <Input
            value={String(value.merchantName || "")}
            onChange={(event) => set("merchantName", event.target.value)}
            placeholder="Bulking"
          />
        </div>
        <div className="grid grid-cols-[1fr_160px] gap-3">
          <div>
            <Label>Chave PIX</Label>
            <Input
              value={String(value.pixKey || "")}
              onChange={(event) => set("pixKey", event.target.value)}
            />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select
              value={String(value.type || "EVP")}
              onValueChange={(next) => set("type", next)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["CPF", "CNPJ", "PHONE", "EMAIL", "EVP"].map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );
  }

  if (messageType === "poll") {
    const poll =
      Array.isArray(value.poll) && value.poll.length > 0
        ? (value.poll as string[])
        : ["", ""];
    return (
      <div className="space-y-4">
        <div>
          <Label>Pergunta</Label>
          <Input
            value={String(value.message || "")}
            onChange={(event) => set("message", event.target.value)}
            placeholder="Qual opção você prefere?"
          />
        </div>
        <ArrayEditor
          title="Opções"
          addLabel="Adicionar opção"
          onAdd={() => set("poll", [...poll, ""])}
        >
          {poll.map((option, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={option}
                onChange={(event) => {
                  const next = [...poll];
                  next[index] = event.target.value;
                  set("poll", next);
                }}
                placeholder={`Opção ${index + 1}`}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={poll.length <= 2}
                onClick={() =>
                  set(
                    "poll",
                    poll.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </ArrayEditor>
        <div>
          <Label>Máximo de opções que cada pessoa pode marcar</Label>
          <Input
            className="w-32"
            type="number"
            min={1}
            max={poll.length}
            value={Number(value.pollMaxOptions || 1)}
            onChange={(event) =>
              set("pollMaxOptions", Number(event.target.value))
            }
          />
        </div>
      </div>
    );
  }

  if (messageType === "carousel") {
    const cards = getArray("cards", emptyCard());
    return (
      <div className="space-y-4">
        <MessageField value={value} onChange={set} />
        <ArrayEditor
          title="Cartões"
          addLabel="Adicionar cartão"
          onAdd={() => set("cards", [...cards, emptyCard()])}
        >
          {cards.map((card, cardIndex) => {
            const actions =
              Array.isArray(card.buttonActions) && card.buttonActions.length > 0
                ? (card.buttonActions as Item[])
                : [emptyAction()];
            const updateCard = (patch: Item) =>
              setArrayItem("cards", cardIndex, patch, emptyCard());
            return (
              <EditorCard
                key={cardIndex}
                title={`Cartão ${cardIndex + 1}`}
                onRemove={() =>
                  removeArrayItem("cards", cardIndex, emptyCard())
                }
              >
                <div className="space-y-3">
                  <div>
                    <Label>Texto</Label>
                    <Input
                      value={String(card.text || "")}
                      onChange={(event) =>
                        updateCard({ text: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Imagem</Label>
                    <Input
                      value={String(card.image || "")}
                      onChange={(event) =>
                        updateCard({ image: event.target.value })
                      }
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Botões</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateCard({
                            buttonActions: [...actions, emptyAction()],
                          })
                        }
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
                      </Button>
                    </div>
                    {actions.map((action, actionIndex) => (
                      <EditorCard
                        key={actionIndex}
                        title={`Botão ${actionIndex + 1}`}
                        onRemove={() => {
                          const next = actions.filter(
                            (_, i) => i !== actionIndex,
                          );
                          updateCard({
                            buttonActions: next.length ? next : [emptyAction()],
                          });
                        }}
                      >
                        <ActionFields
                          value={action}
                          onChange={(patch) => {
                            const next = [...actions];
                            next[actionIndex] = {
                              ...next[actionIndex],
                              ...patch,
                            };
                            updateCard({ buttonActions: next });
                          }}
                        />
                      </EditorCard>
                    ))}
                  </div>
                </div>
              </EditorCard>
            );
          })}
        </ArrayEditor>
      </div>
    );
  }

  if (messageType === "list") {
    const sections = getArray("sections", emptySection());
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Título</Label>
            <Input
              value={String(value.title || "")}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
          <div>
            <Label>Texto do botão</Label>
            <Input
              value={String(value.buttonText || "")}
              onChange={(e) => set("buttonText", e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label>Descrição</Label>
          <Textarea
            rows={2}
            value={String(value.description || "")}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div>
          <Label>Rodapé</Label>
          <Input
            value={String(value.footerText || "")}
            onChange={(e) => set("footerText", e.target.value)}
          />
        </div>
        <ArrayEditor
          title="Seções"
          addLabel="Adicionar seção"
          onAdd={() => set("sections", [...sections, emptySection()])}
        >
          {sections.map((section, sectionIndex) => {
            const rows =
              Array.isArray(section.rows) && section.rows.length > 0
                ? (section.rows as Item[])
                : [emptyRow()];
            const updateSection = (patch: Item) =>
              setArrayItem("sections", sectionIndex, patch, emptySection());
            return (
              <EditorCard
                key={sectionIndex}
                title={`Seção ${sectionIndex + 1}`}
                onRemove={() =>
                  removeArrayItem("sections", sectionIndex, emptySection())
                }
              >
                <div className="space-y-3">
                  <div>
                    <Label>Título da seção</Label>
                    <Input
                      value={String(section.title || "")}
                      onChange={(e) => updateSection({ title: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Opções</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateSection({
                          rows: [
                            ...rows,
                            {
                              title: "",
                              description: "",
                              rowId: `option-${rows.length + 1}`,
                            },
                          ],
                        })
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
                    </Button>
                  </div>
                  {rows.map((row, rowIndex) => (
                    <EditorCard
                      key={rowIndex}
                      title={`Opção ${rowIndex + 1}`}
                      onRemove={() => {
                        const next = rows.filter((_, i) => i !== rowIndex);
                        updateSection({
                          rows: next.length ? next : [emptyRow()],
                        });
                      }}
                    >
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label>Título</Label>
                            <Input
                              value={String(row.title || "")}
                              onChange={(e) => {
                                const next = [...rows];
                                next[rowIndex] = {
                                  ...row,
                                  title: e.target.value,
                                };
                                updateSection({ rows: next });
                              }}
                            />
                          </div>
                          <div>
                            <Label>ID</Label>
                            <Input
                              value={String(row.rowId || "")}
                              onChange={(e) => {
                                const next = [...rows];
                                next[rowIndex] = {
                                  ...row,
                                  rowId: e.target.value,
                                };
                                updateSection({ rows: next });
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <Label>Descrição</Label>
                          <Input
                            value={String(row.description || "")}
                            onChange={(e) => {
                              const next = [...rows];
                              next[rowIndex] = {
                                ...row,
                                description: e.target.value,
                              };
                              updateSection({ rows: next });
                            }}
                          />
                        </div>
                      </div>
                    </EditorCard>
                  ))}
                </div>
              </EditorCard>
            );
          })}
        </ArrayEditor>
      </div>
    );
  }

  if (messageType === "reaction" || messageType === "remove_reaction") {
    return (
      <div className="grid grid-cols-[120px_1fr] gap-3">
        {messageType === "reaction" && (
          <div>
            <Label>Emoji</Label>
            <Input
              value={String(value.reaction || "")}
              onChange={(event) => set("reaction", event.target.value)}
              placeholder="👍"
            />
          </div>
        )}
        <div className={messageType === "remove_reaction" ? "col-span-2" : ""}>
          <Label>ID da mensagem</Label>
          <Input
            value={String(value.messageId || "")}
            onChange={(event) => set("messageId", event.target.value)}
            placeholder="Message ID retornado pela W-API"
          />
        </div>
      </div>
    );
  }

  return null;
}

function MessageField({
  value,
  onChange,
}: {
  value: Item;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <div>
      <Label>Mensagem</Label>
      <Textarea
        value={String(value.message || "")}
        onChange={(event) => onChange("message", event.target.value)}
        rows={3}
      />
    </div>
  );
}

function ContactFields({
  value,
  onChange,
}: {
  value: Item;
  onChange: (patch: Item) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Nome</Label>
          <Input
            value={String(value.contactName || "")}
            onChange={(e) => onChange({ contactName: e.target.value })}
          />
        </div>
        <div>
          <Label>Telefone</Label>
          <Input
            value={String(value.contactPhone || "")}
            onChange={(e) => onChange({ contactPhone: e.target.value })}
            placeholder="5562999999999"
          />
        </div>
      </div>
      <div>
        <Label>Descrição comercial (opcional)</Label>
        <Input
          value={String(value.contactBusinessDescription || "")}
          onChange={(e) =>
            onChange({ contactBusinessDescription: e.target.value })
          }
        />
      </div>
    </div>
  );
}

function ActionFields({
  value,
  onChange,
}: {
  value: Item;
  onChange: (patch: Item) => void;
}) {
  const type = String(value.type || "REPLAY");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[140px_1fr] gap-3">
        <div>
          <Label>Tipo</Label>
          <Select
            value={type}
            onValueChange={(next) => onChange({ type: next })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REPLAY">Resposta</SelectItem>
              <SelectItem value="URL">Link</SelectItem>
              <SelectItem value="CALL">Ligação</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Texto</Label>
          <Input
            value={String(value.buttonText || "")}
            onChange={(e) => onChange({ buttonText: e.target.value })}
          />
        </div>
      </div>
      {type === "URL" && (
        <div>
          <Label>URL</Label>
          <Input
            value={String(value.url || "")}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://..."
          />
        </div>
      )}
      {type === "CALL" && (
        <div>
          <Label>Telefone</Label>
          <Input
            value={String(value.phone || "")}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="+5562999999999"
          />
        </div>
      )}
    </div>
  );
}

function ArrayEditor({
  title,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{title}</Label>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {addLabel}
        </Button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function EditorCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {children}
    </div>
  );
}
