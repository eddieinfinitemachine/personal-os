# Send Health to Personal OS

An iOS Shortcut that sends one day of diet (from your food app, by way of Apple
Health) and the day's vitals to `POST /api/capture/health`. A Personal
Automation runs it every night. The Health page's Nutrition card, its chat and
its picture read the diet; the vitals land in Biometrics, where the Workout tab
reads HRV and resting heart rate for its recovery check.

Apple Health has no web API, so the phone has to send the data. Your food app
must be allowed to write nutrition to Apple Health (in the app's settings, or
Settings → Health → Data Access & Devices).

## Build the Shortcut

Make a new Shortcut named **Send Health to Personal OS**.

### 1. The day

1. **Date** → Current Date. Save it as `Date`.
2. **Format Date** → `Date`, Date Format **Custom**, `yyyy-MM-dd`. Save it as `Day`.

### 2. Read Health

Every item here is optional. Leave out whatever you don't track; the endpoint
saves whatever it gets.

**Diet** (one block per type):

1. **Find Health Samples** where Type is the type below and Start Date is today.
2. **Calculate Statistics** → Sum of the samples.
3. Save it as a variable named after the type.

Don't widen the filter to "the last 2 days": the sum would add two days
together under one date. To catch a dinner logged after the automation ran,
repeat these blocks with Start Date is yesterday and send both days (see the
note under step 3).

Types: Dietary Energy (kcal), Protein, Carbohydrates, Total Fat, Saturated Fat,
Fiber, Sugar, Sodium.

**Vitals**:

- Weight, Body Fat Percentage, Resting Heart Rate, Heart Rate Variability,
  VO2 Max: **Find Health Samples** of the type, Sort by Start Date, Order
  Latest First, Limit 1. Save each.
- Steps: **Find Health Samples** of Steps where Start Date is today →
  **Calculate Statistics** → Sum.
- Sleep: **Find Health Samples** of Sleep Analysis where Value is Asleep (or
  the Core, Deep and REM stages, where Shortcuts lists them) and Start Date is
  in the last 1 day → **Get Details of Health Sample** →
  Duration → **Calculate Statistics** → Sum → **Calculate** ÷ 3600. Save it
  as `Sleep Hours`.

### 3. The dictionary

Add a **Dictionary** action with these keys (Text or Number values, each set
to the variable from step 2):

| Key | Value |
| --- | --- |
| `app` | your food app's name, typed once |
| `date` | `Day` |
| `calories` | Dietary Energy |
| `protein` | Protein |
| `carbs` | Carbohydrates |
| `fat` | Total Fat |
| `saturatedFat` | Saturated Fat |
| `fiber` | Fiber |
| `sugar` | Sugar |
| `sodium` | Sodium |
| `weight` | Weight |
| `bodyFat` | Body Fat Percentage |
| `restingHeartRate` | Resting Heart Rate |
| `hrv` | Heart Rate Variability |
| `vo2Max` | VO2 Max |
| `steps` | Steps |
| `sleepHours` | Sleep Hours |

Values with units are fine ("1,842 kcal", "82.5 kg", "2.3 g" of sodium, "7700
kJ", "420 min" of sleep): the endpoint converts them. A day sent again
replaces that day, so re-sending yesterday is safe. To send yesterday too, make
a second dictionary with yesterday's `date` and diet keys, and add a `days` key
to the main dictionary holding a list of that dictionary (up to 60 days per
send).

### 4. Send it

**Get Contents of URL**:

- URL: `https://<your host>/api/capture/health`
- Method: **POST**. Tap "Show More" to find the Method field. It defaults to
  GET, and a GET saves nothing (the endpoint answers 405).
- Headers: `Authorization` = `Bearer <CAPTURE_TOKEN>`
- Request Body: **JSON** → the Dictionary from step 3.

### 5. Show the answer

**Show Result** → Contents of URL. A good run shows something like
`{"days":1,"readings":6,"stored":true}`. Anything else is the error to fix. A
Shortcut finishing without complaint proves nothing on its own, so keep this
step.

`"reason":"no-human"` means there is no Health profile yet, so the vitals were
skipped. `"stored":false` means the server's database doesn't have the
nutrition table yet; the vitals were still saved.

## Run it nightly

Shortcuts → Automation → **+** → **Time of Day**: 11:30 PM, Daily, **Run
Immediately**. Action: Run Shortcut → Send Health to Personal OS. The first
run asks for Health access: allow every type you added.

## Check it worked

- The **Nutrition** card on the Health page shows "Last 7 days · 1 logged" and
  your food app's name.
- The next morning, the Workout tab's health card shows HRV and resting heart
  rate from Apple Health.
