# legacy-tickets Vision

## Kurzfassung

`legacy-tickets` ist das operative Gedaechtnis fuer Fehler, Aufgaben und Ideen
in Legacy. Menschen und der Autopilot legen Tickets an; die KI ruft sie ueber
MCP ab, arbeitet sie ab und lernt daraus.

Der Satellit ist kein Projektmanagement-Monster und kein Jira-Klon. Er ist der
Ort, an dem festgehalten wird, was kaputt ist, was fehlt und was als Naechstes
getan werden sollte — so, dass Mensch UND Maschine damit arbeiten koennen.

## Mission

`legacy-tickets` beantwortet immer wieder die gleichen operativen Fragen:

- Was ist gerade kaputt?
- Was ist dringend?
- Woran arbeitet der Autopilot gerade?
- Welche Aufgaben liegen offen, welche sind blockiert?
- Was wurde geloest, und wie?
- Welche Fehler tauchen wiederholt auf?

Der Satellit soll den Zustand der Legacy-Flotte nicht in Koepfen oder Chats
verstecken, sondern in einem Board sichtbar machen, das beide Seiten lesen
und beschreiben koennen.

## Grundidee

Legacy besteht aus vielen kleinen Diensten (Satelliten), einem Gateway und dem
Autopilot. Ueberall entstehen Fehler, Aufgaben und Ideen:

- ein Mensch bemerkt einen Bug im Studio
- der Autopilot stolpert in einem Run ueber einen kaputten Endpunkt
- ein Review foerdert eine fehlende Funktion zutage
- eine Beobachtung wird zu einer Aufgabe fuer spaeter

`legacy-tickets` ist die eine Ablage dafuer. Der zentrale Arbeitsfluss:

```text
Ein Mensch ODER der Autopilot legt ein Ticket an (Bug, Task, Feature, Frage).
Der Autopilot ruft offene Tickets ueber MCP ab und arbeitet sie ab.
Fortschritt, Kommentare und Statuswechsel landen als Aktivitaet am Ticket.
Ein Mensch sieht im Board jederzeit, was offen, blockiert oder geloest ist.
```

Damit ist `legacy-tickets` der Kern der Selbstoptimierungs-Schleife: die KI
meldet ihre eigenen Fehler, holt sich ihre eigene Arbeit und dokumentiert,
was sie getan hat.

## Was der Satellit inhaltlich koennen soll

### 1. Tickets sammeln

Der Satellit nimmt alles auf, was operativ zaehlt:

- Bugs mit Schweregrad (minor/major/critical)
- Aufgaben (Tasks), die jemand erledigen soll
- Feature-Ideen, die noch keine Vision-Reife haben
- Fragen, die geklaert werden muessen

Jedes Ticket traegt eine menschenlesbare Referenz (`TCK-001`, `TCK-002`, ...),
eine Prioritaet (low/medium/high/urgent), optional einen Bereich (`area`,
z. B. der betroffene Satellit) und freie Labels.

### 2. Herkunft transparent machen

Jedes Ticket weiss, wer es angelegt hat:

- `origin: manual` — ein Mensch im Board
- `origin: autopilot` — die KI ueber das Gateway, optional mit `sourceRun`

Im Board ist Autopilot-Herkunft sichtbar markiert. Niemand soll raten muessen,
ob eine Meldung von einem Menschen oder aus einem Run stammt.

### 3. Arbeit dokumentieren (Aktivitaet)

Jedes Ticket fuehrt einen Aktivitaets-Thread:

- Kommentare von Mensch, Autopilot oder System
- Statuswechsel mit Notiz
- Zuweisungen

Der Thread ist das Protokoll der Zusammenarbeit: Wenn der Autopilot ein Ticket
bearbeitet, kommentiert er, was er getan hat. Wenn ein Mensch nachfragt, steht
die Frage am Ticket, nicht in einem Chat, der verloren geht.

### 4. Status fuehren

Der Lebenszyklus ist bewusst klein gehalten:

```text
open -> in_progress -> resolved -> closed
         |                ^
         v                |
       blocked -----------+
```

- `open` — gemeldet, noch nicht in Arbeit
- `in_progress` — jemand (Mensch oder KI) arbeitet daran
- `blocked` — es geht nicht weiter, der Grund steht im Thread
- `resolved` — geloest, wartet auf Bestaetigung/Abschluss
- `closed` — abgeschlossen

`resolved` und `closed` setzen einen `resolvedAt`-Zeitstempel; ein Wiederoeffnen
loescht ihn wieder.

### 5. Ueberblick liefern

Das Board verdichtet den Zustand:

- Zaehler pro Status, Prioritaet und Art
- die dringenden offenen Tickets (urgent)
- die neuesten Tickets

So sieht ein Mensch in Sekunden, ob die Flotte gesund ist — und der Autopilot
kann sich die wichtigste offene Arbeit holen.

### 6. Die Selbstoptimierungs-Schleife tragen

Der eigentliche Zweck: Die KI soll aus ihren eigenen Fehlern lernen.

```text
1. Ein Run schlaegt fehl oder ein Mensch meldet einen Fehler im Chat.
2. Der Autopilot legt ein Ticket an (tickets.create), mit sourceRun.
3. In spaeteren Runs ruft er offene Tickets ab (tickets.list / tickets.board).
4. Er arbeitet ein Ticket ab, kommentiert den Fortschritt (tickets.comment)
   und setzt den Status (tickets.set_status).
5. Ein Mensch prueft das Ergebnis im Board und schliesst oder loescht.
```

## Was KI uebernehmen darf

Die KI darf ueber das Gateway:

- Tickets anlegen (Bug, Task, Feature, Frage)
- Tickets lesen, filtern und das Board abrufen
- Ticket-Felder pflegen (Titel, Text, Prioritaet, Labels, Zuweisung, Bereich)
- kommentieren und Fortschritt dokumentieren
- Status setzen — auch auf `resolved` oder `closed`
- Triage machen: Prioritaeten vorschlagen und setzen, Duplikate benennen

Das alles ist bewusst erlaubt, weil es reine interne Ops ohne Aussenwirkung
sind: kein Versand, keine Publikation, keine Kundenwirkung. Ein falsch
gesetzter Status ist im Board sichtbar und in Sekunden korrigiert — der
Aktivitaets-Thread haelt jede Aenderung fest.

## Was KI nicht allein entscheiden darf

Die eine harte Grenze:

- **Loeschen ist Menschensache.** Ein Service-Token (Autopilot/Gateway) kann
  kein Ticket loeschen — der Versuch endet mit
  `403 "Loeschen nur durch Menschen im Ticket-Board"`.
  Es gibt dafuer auch bewusst kein Gateway-Tool.

Warum genau diese Grenze: Alles andere ist rekonstruierbar und auditierbar
(Aktivitaets-Thread), Loeschen vernichtet Gedaechtnis. Die KI soll ihr eigenes
Protokoll nicht ausradieren koennen — auch nicht versehentlich.

## Beziehung zu anderen Satelliten

### autopilot

`autopilot` ist der wichtigste Schreiber und Leser. Der Operator-Chat legt
Tickets an, wenn im Gespraech ein Bug oder eine Aufgabe gemeldet wird; Runs
melden Fehler mit `sourceRun` und holen sich offene Arbeit.

### gateway

`gateway` exponiert die Ticket-Routen als MCP-Tools (`tickets.*`). Loeschen
hat bewusst kein Tool.

### vision

`vision` haelt Richtung, `tickets` haelt Betrieb. Eine Feature-Idee, die
Richtung beruehrt, gehoert ins Vision Board; eine konkrete Aufgabe hierher.
Der Autopilot entscheidet beim Einsortieren.

### metrics

`metrics` misst, `tickets` handelt. Wenn eine Kennzahl kippt, kann daraus ein
Ticket werden; wenn viele Bugs in einem Bereich auflaufen, ist das ein Signal
fuer `metrics` und `cofounder`.

### cofounder

`cofounder` kann aus wiederkehrenden Tickets strategische Fragen ableiten:
Was bricht staendig? Wo fehlt Substanz? Was sollte grundsaetzlich anders sein?

## Typische Nutzungssituationen

### Bug im Chat melden

```text
"Der Blog-Editor verliert beim Speichern die Tags."
Der Autopilot legt ein Bug-Ticket an (kind bug, severity major, area blog)
und antwortet mit der Referenz TCK-017.
```

### Autopilot meldet eigenen Fehler

```text
Ein Run scheitert am Deck-Export. Der Autopilot legt ein Ticket mit
sourceRun an, damit die naechste Session das Problem kennt.
```

### Offene Arbeit abrufen

```text
"Was ist offen und dringend?" — tickets.board liefert Zaehler und die
Urgent-Liste; tickets.list?status=open&priority=urgent die Details.
```

### Ticket abarbeiten

```text
Der Autopilot setzt TCK-017 auf in_progress, kommentiert seine Analyse,
setzt resolved mit einer Notiz. Ein Mensch prueft im Board und schliesst.
```

### Aufraeumen

```text
Ein Mensch loescht ein Duplikat im Board. Nur er kann das — der Autopilot
haette es hoechstens als Duplikat kommentieren und schliessen koennen.
```

## Output-Formate

Der Satellit erzeugt:

- Ticket (JSON, mit Referenz, Aktivitaet und Zeitstempeln)
- gefilterte Ticketlisten (Status/Art/Prioritaet/Label/Zustaendig/Suche)
- Board-Uebersicht (Zaehler, Recent, Urgent)
- Aktivitaets-Thread pro Ticket (Kommentar/Status/Zuweisung, akteur-markiert)

## Persoenlichkeit

`legacy-tickets` soll nuechtern, schnell und ehrlich sein.

Kein Prozess-Theater, keine Pflichtfelder-Wueste. Ein Ticket ist in zehn
Sekunden angelegt und in einem Blick verstanden. Der Ton im Board:

```text
klar, operativ, ohne Drama — kaputt ist kaputt, geloest ist geloest
```

## Reifestufen

### V0: Ticket-Ablage

Tickets mit Referenz, Status, Prioritaet und Aktivitaet; Board-UI mit
Filtern; Gateway-Tools fuer den Autopilot.

### V1: Selbstmeldung

Der Autopilot legt bei fehlgeschlagenen Runs selbststaendig Tickets mit
`sourceRun` an und verweist im Chat auf die Referenz.

### V2: Triage

Der Autopilot prioritisiert offene Tickets, erkennt Duplikate und schlaegt
Zuordnungen (area/assignee) vor.

### V3: Abarbeitung

Der Autopilot holt sich offene Tickets als Arbeitsauftraege, dokumentiert
Fortschritt im Thread und liefert Loesungen zur menschlichen Pruefung.

### V4: Lernschleife

Der Satellit erkennt Muster ueber Tickets hinweg (gleicher Bereich, gleiche
Ursache) und speist sie als Erkenntnisse in vision/metrics/cofounder ein.

## Grenzen

`legacy-tickets` soll kein zweites Vision Board und kein Notizfriedhof werden.
Was Richtung ist, gehoert zu `vision`; was Forschung ist, zu `research`. Hier
liegt nur, was getan, geklaert oder repariert werden soll.

Und: Der Satellit bewertet nicht selbst. Er haelt fest. Die Intelligenz
(Triage, Abarbeitung, Lernen) kommt vom Autopilot ueber MCP — im Satelliten
selbst gibt es bewusst KEIN LLM.

## Bauhinweis fuer spaetere Implementierung

Dieses Dokument beschreibt die inhaltliche Vision.

Die technische Umsetzung folgt dem Muster der laufenden Legacy-Satelliten,
insbesondere:

- `legacy-vision` (Board-Studio, Domain-Layer, Guard-Muster)
- `legacy-blog` (Publikations- bzw. hier: Loesch-Grenze)
- `legacy-gateway` (Tool-Namespace `tickets.*`)
- `legacy-autopilot` (Allowlist, Operator-Chat-Integration)

Die `README.md` in diesem Ordner beschreibt den konkreten Scaffold: Domain in
`lib/tickets/`, duenne `app/api/**`-Routen, `/board` als Studio-Oberflaeche.
