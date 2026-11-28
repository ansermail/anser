import { t } from "@/lib/i18n";
import { useConfirmation } from "@/hooks/use-confirmation";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  UserRound,
  Pencil,
  Trash2,
  Mail,
  X,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { call } from "@/lib/api";
import { hasAddressName } from "@/lib/addresses";
import type {
  Address,
  Contact,
  PgpImportResult,
  PgpKeyInfo,
} from "@/lib/types";
import { formatFingerprint } from "./openpgp-banner";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Separator } from "./ui/separator";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./ui/input-group";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import { Label } from "./ui/label";
import { SidebarTrigger } from "./ui/sidebar";
import { Skeleton } from "./ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { toast } from "sonner";

export function ContactsPanel({
  initial,
  onCompose,
}: {
  initial: Address | null;
  onCompose: (address: Address) => void;
}) {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const [contacts, setContacts] = useState<Contact[]>([]),
    [pgpKeys, setPgpKeys] = useState<PgpKeyInfo[]>([]),
    [keyPaste, setKeyPaste] = useState(""),
    [importingKey, setImportingKey] = useState(false),
    [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Contact | null>(
    initial ? { ...initial, id: crypto.randomUUID() } : null,
  );
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    try {
      const [list, keys] = await Promise.all([
        call<Contact[]>("list_contacts"),
        call<PgpKeyInfo[]>("list_pgp_keys").catch(() => [] as PgpKeyInfo[]),
      ]);
      setContacts(list);
      setPgpKeys(keys);
      setLoadFailed(false);
    } catch (e) {
      setLoadFailed(true);
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  }
  const pgpKeyFor = (email: string) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return undefined;
    return pgpKeys.find(
      (k) => !k.revoked && k.emails.some((e) => e.toLowerCase() === normalized),
    );
  };
  useEffect(() => {
    void refresh();
  }, []);
  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await call("save_contact", { contact: editing });
      setEditing(null);
      await refresh();
      toast.success(t("Contact saved"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  const visible = contacts.filter((c) =>
    `${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  const addContact = () =>
    setEditing({ id: crypto.randomUUID(), name: "", email: "" });
  const clearSearch = () => {
    setSearch("");
    searchInput.current?.focus();
  };
  return (
    <section className="workspace-panel">
      <div className="panel-heading">
        <div className="page-title-row">
          <SidebarTrigger
            title={t("Toggle sidebar")}
            aria-label={t("Toggle sidebar")}
          />
          <span className="page-title-text">
            <h1>{t("Contacts")}</h1>
            {contacts.length > 0 && (
              <span className="page-title-count tabular-nums">
                {contacts.length === 1
                  ? t("1 local contact")
                  : t("{value0} local contacts", { value0: contacts.length })}
              </span>
            )}
          </span>
        </div>
        {(loading || contacts.length > 0) && (
          <Button onClick={addContact}>
            <Plus />
            {t("Add contact")}
          </Button>
        )}
      </div>
      {(loading || contacts.length > 0 || search) && (
        <InputGroup className="contact-search">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchInput}
            aria-label={t("Search contacts")}
            placeholder={t("Search by name or email…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && visible.length > 0 && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                aria-label={t("Clear search")}
                onClick={clearSearch}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      )}
      <div className="contact-list">
        {visible.map((c) => {
          const contactKey = pgpKeyFor(c.email);
          return (
            <article className="contact-card" key={c.id}>
              <span className="contact-avatar">
                <UserRound size={19} />
              </span>
              <div className="contact-identity">
                <div className="flex items-center gap-1.5">
                  <strong title={hasAddressName(c) ? c.name : c.email}>
                    {hasAddressName(c) ? c.name : c.email}
                  </strong>
                  {contactKey && (
                    <Badge
                      variant="secondary"
                      className="h-4 shrink-0 gap-0.5 px-1 text-[10px]"
                      title={formatFingerprint(contactKey.fingerprint)}
                    >
                      <ShieldCheck size={10} aria-hidden="true" />
                      PGP
                    </Badge>
                  )}
                </div>
                {hasAddressName(c) && <p title={c.email}>{c.email}</p>}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("Compose")}
                onClick={() => onCompose(c)}
              >
                <Mail size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("Edit contact")}
                onClick={() => setEditing(c)}
              >
                <Pencil size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("Delete contact")}
                data-reveal-row-action=""
                className="contact-delete"
                onClick={async () => {
                  if (
                    await askConfirmation({
                      title: t("Delete contact?"),
                      description: t(
                        "Delete the local contact record for {value0}. Messages and conversation history are unaffected.",
                        { value0: c.name || c.email },
                      ),
                      action: t("Delete contact"),
                      destructive: true,
                    })
                  )
                    void call("delete_contact", { id: c.id })
                      .then(refresh)
                      .catch((e) => toast.error(String(e)));
                }}
              >
                <Trash2 size={15} />
              </Button>
            </article>
          );
        })}
        {loading && (
          <>
            <span role="status" className="sr-only">
              {t("Loading contacts…")}
            </span>
            {[0, 1, 2].map((index) => (
              <div className="contact-card" aria-hidden="true" key={index}>
                <Skeleton className="contact-avatar" />
                <div className="contact-identity flex flex-col gap-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-40 max-w-full" />
                </div>
              </div>
            ))}
          </>
        )}
        {!loading && !visible.length && loadFailed && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRound />
              </EmptyMedia>
              <EmptyTitle>{t("Could not read")}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  setLoading(true);
                  void refresh();
                }}
              >
                {t("Retry")}
              </Button>
            </EmptyContent>
          </Empty>
        )}
        {!loading && !visible.length && !loadFailed && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {search ? <Search /> : <UserRound />}
              </EmptyMedia>
              <EmptyTitle>
                {search
                  ? t("No matching contacts")
                  : t("Save frequent contacts")}
              </EmptyTitle>
              {!search && (
                <EmptyDescription>
                  {t("You can also add contacts from the sender menu.")}
                </EmptyDescription>
              )}
            </EmptyHeader>
            <EmptyContent>
              {search ? (
                <Button variant="outline" onClick={clearSearch}>
                  {t("Clear search")}
                </Button>
              ) : (
                <Button onClick={addContact}>
                  <Plus />
                  {t("Add contact")}
                </Button>
              )}
            </EmptyContent>
          </Empty>
        )}
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v && !busy) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-[430px]">
          <DialogHeader>
            <DialogTitle>{t("Contact details")}</DialogTitle>
            <DialogDescription>
              {t("Saved on this device, available for address autocomplete.")}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="contact-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="field">
                <Label htmlFor="contact-name">{t("Name")}</Label>
                <Input
                  id="contact-name"
                  autoFocus
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <Label htmlFor="contact-email">{t("Email")}</Label>
                <Input
                  id="contact-email"
                  type="email"
                  required
                  value={editing.email}
                  onChange={(e) =>
                    setEditing({ ...editing, email: e.target.value })
                  }
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? t("Saving…") : t("Save contact")}
              </Button>
              {editing.email.trim() && (
                <>
                  <Separator className="my-1" />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <ShieldCheck
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {t("OpenPGP public key")}
                      </span>
                      {pgpKeyFor(editing.email) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-destructive"
                          onClick={async () => {
                            const k = pgpKeyFor(editing.email);
                            if (!k) return;
                            try {
                              await call("delete_pgp_key", {
                                fingerprint: k.fingerprint,
                              });
                              await refresh();
                              toast.success(t("OpenPGP key removed"));
                            } catch (err) {
                              toast.error(String(err));
                            }
                          }}
                        >
                          {t("Remove key")}
                        </Button>
                      )}
                    </div>
                    {pgpKeyFor(editing.email) ? (
                      <div className="rounded-md border p-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {pgpKeyFor(editing.email)!.algorithm}
                          </Badge>
                          <span className="truncate text-muted-foreground">
                            {pgpKeyFor(editing.email)!.userIds[0] ||
                              pgpKeyFor(editing.email)!.email}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
                          {formatFingerprint(
                            pgpKeyFor(editing.email)!.fingerprint,
                          )}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Textarea
                          rows={4}
                          className="font-mono text-xs"
                          placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
                          value={keyPaste}
                          onChange={(e) => setKeyPaste(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={importingKey || !keyPaste.trim()}
                          onClick={async () => {
                            setImportingKey(true);
                            try {
                              const res = await call<PgpImportResult>(
                                "import_pgp_keys",
                                {
                                  armored: keyPaste,
                                  accountId: null,
                                  passphrase: null,
                                  rememberPassphrase: false,
                                },
                              );
                              setKeyPaste("");
                              await refresh();
                              toast.success(
                                t("Imported {value0} OpenPGP key(s)", {
                                  value0: res.imported.length,
                                }),
                              );
                            } catch (err) {
                              toast.error(String(err));
                            } finally {
                              setImportingKey(false);
                            }
                          }}
                        >
                          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                          {importingKey
                            ? t("Importing…")
                            : t("Import public key")}
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </section>
  );
}
