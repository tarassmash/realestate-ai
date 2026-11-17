# Realty Photo AI для iOS — как выложить в App Store

Проект: `ios/RealtyPhotoAI.xcodeproj` · SwiftUI · iOS 17+ · только iPhone, портрет · языки EN / ES / RU
Bundle ID: `com.realtyphotoai.app` · Сервер: `https://web-production-88f12.up.railway.app`
Модель оплаты: **одна подписка — $9.99 в неделю, 15 фото в неделю**; 3 бесплатных фото после регистрации.

> Сборка для App Store — только **Xcode 26+ на Mac** (с 28 апреля 2026 Apple принимает сборки только с iOS 26 SDK).

---

## 0. Что уже готово в проекте

| Требование Apple | Где |
|---|---|
| Нативное приложение (не «обёртка сайта», 4.2) | SwiftUI: обработка, камера, до/после, история, аккаунт |
| Цифровой доступ — только через Apple (3.1.1) | StoreKit 2, автопродляемая подписка; сервер проверяет подпись Apple |
| Экран подписки (3.1.2): название, срок, цена за период, условия автопродления, ссылки на Условия и Конфиденциальность | `Features/Store/StoreView.swift` (SubscriptionView) |
| «Восстановить покупки» | экран подписки и Аккаунт |
| Управление подпиской из приложения | Аккаунт → «Управлять подпиской» (системное окно Apple) |
| Удаление аккаунта в приложении (5.1.1(v)) | Аккаунт → «Удалить аккаунт» (с напоминанием отменить подписку) |
| Privacy Manifest | `Resources/PrivacyInfo.xcprivacy` |
| Тексты разрешений (камера, сохранение в Фото) на 3 языках | `Resources/*.lproj/InfoPlist.strings` |
| Шифрование только HTTPS | `ITSAppUsesNonExemptEncryption = NO` |
| Иконка 1024×1024 без прозрачности | `Resources/Assets.xcassets/AppIcon.appiconset` |
| Продления и возвраты синхронизируются | `/api/iap/notifications` (App Store Server Notifications V2) |

В приложении **нет** ссылок на оплату на сайте — это запрещено (3.1.1). Аккаунт общий: подписку, оформленную на сайте, приложение тоже видит (3.1.3(b) — потому что та же подписка продаётся и в приложении).

---

## 1. Подготовка аккаунта (один раз)

1. **Apple Developer Program** — https://developer.apple.com/programs/ (99 $/год).
2. App Store Connect → **Business** → подпишите **Paid Apps Agreement**, заполните банк и налоги. Без этого подписки не работают даже в тесте.
3. **App Store Small Business Program** — комиссия 15 % вместо 30 %. Расчёт лимита 15 фото/неделю сделан под 15 %.
4. **Статус трейдера (DSA, ЕС)** — Business → Digital Services Act. Без этого приложения не будет в Испании и ЕС.

## 2. Открыть проект в Xcode

1. Откройте `ios/RealtyPhotoAI.xcodeproj`.
2. Таргет **RealtyPhotoAI** → **Signing & Capabilities**:
   - **Team** — ваша команда;
   - **Bundle Identifier** — `com.realtyphotoai.app` или свой. **Если меняете — добавьте на Railway `APPLE_BUNDLE_ID` с тем же значением**;
   - **+ Capability → In-App Purchase**.
3. ⌘R на симуляторе — вход, обработка, история работают с вашим сервером.

## 3. Создать приложение в App Store Connect

**Apps → + → New App**: iOS, имя `Realty Photo AI` (если занято — `Realty Photo AI: Staging`), основной язык Spanish (Spain) или English, Bundle ID как в Xcode, SKU `realtyphotoai-ios`.

## 4. Подписка

**Monetization → Subscriptions**:

1. **Subscription Group** → создайте группу `Realty Photo AI` (локализация группы: `Realty Photo AI` на всех языках).
2. В группе → **+ Create Subscription**:

| Поле | Значение |
|---|---|
| Reference Name | Weekly |
| Product ID | `com.realtyphotoai.app.weekly` (= `<Bundle ID>.weekly`) |
| Subscription Duration | **1 Week** |
| Price | **$9.99** (USA) — остальные страны Apple пересчитает автоматически (в еврозоне ≈ 9,99 €) |
| Family Sharing | выключено |

Локализации подписки (Display Name / Description):

| | Display Name | Description |
|---|---|---|
| EN | Weekly plan | 15 AI photo edits every week |
| ES | Plan semanal | 15 ediciones de fotos con IA cada semana |
| RU | Подписка на неделю | 15 обработок фото ИИ каждую неделю |

3. **Review Information** подписки: скриншот экрана подписки в приложении и заметка `Weekly auto-renewable subscription: 15 AI photo edits per week.`
4. **App Store Server Notifications** (App Information), версия **2**, Production и Sandbox:
```
https://web-production-88f12.up.railway.app/api/iap/notifications
```

> Лимит и цену на сайте меняют переменные Railway `SUB_WEEKLY_LIMIT` и `SUB_PRICE` (в центах). Цену в App Store — в App Store Connect.

## 5. Страница в App Store

- Категория: **Photo & Video**, дополнительная — **Business**
- Age Rating: на все вопросы «No / None» → 4+
- Privacy Policy URL: `https://web-production-88f12.up.railway.app/privacidad`
- Support URL: `https://web-production-88f12.up.railway.app/`
- **License Agreement (EULA)**: можно оставить стандартный EULA Apple — ссылка на наши Условия уже есть в описании ниже (для подписок Apple требует ссылку на Terms of Use в описании или в поле EULA).

### Тексты

**Spanish (Spain)**
- Subtitle (≤30): `Fotos IA para inmobiliarias`
- Promotional Text: `Amuebla pisos vacíos, cambia el cielo y crea fotos al atardecer en 30 segundos. 3 fotos gratis al registrarte.`
- Keywords: `home staging,inmobiliaria,fotos pisos,amueblar,idealista,fotocasa,hdr,agente,ia,decorar,cielo`
- Description:
```
Fotos que venden pisos, en 30 segundos.

Sube la foto, elige qué hacer y descarga el resultado:
• Mejora automática: luz, HDR y verticales rectas
• Amueblado virtual en 7 estilos
• Despejar y estancia vacía
• Cielo nuevo y luz de atardecer
• Jardín, renovar, escalado y tarea propia

Compara antes y después, guarda en Fotos o comparte. Las fotos modificadas llevan la marca «Amueblado virtual», como exigen los portales.

UN SOLO PLAN
• 3 fotos gratis al registrarte, sin tarjeta
• Suscripción semanal: 15 fotos cada semana
• Cancela cuando quieras

La suscripción se renueva automáticamente cada semana salvo que se cancele al menos 24 horas antes del final del periodo. El pago se carga a tu cuenta de Apple. Gestiona o cancela la suscripción en los ajustes de tu cuenta del App Store.

Condiciones de uso: https://web-production-88f12.up.railway.app/condiciones
Privacidad: https://web-production-88f12.up.railway.app/privacidad
```

**English**
- Subtitle: `AI photos for real estate`
- Promotional Text: `Stage empty rooms, replace grey skies and create twilight shots in 30 seconds. 3 free photos when you sign up.`
- Keywords: `virtual staging,real estate,listing photos,realtor,hdr,interior,furniture,ai,property,sky`
- Description:
```
Listing photos that sell — in 30 seconds.

Upload a photo, pick what to do, download the result:
• Auto enhance: light, HDR, straight verticals
• Virtual staging in 7 styles
• Declutter and empty room
• New sky and twilight light
• Lawn, fresh paint, upscaling and custom tasks

Compare before and after, save to Photos or share. Edited photos get a “Virtually staged” label, as listing portals require.

ONE PLAN
• 3 free photos when you sign up, no card
• Weekly subscription: 15 photos every week
• Cancel anytime

The subscription renews automatically every week unless canceled at least 24 hours before the end of the current period. Payment is charged to your Apple Account. Manage or cancel it in your App Store account settings.

Terms of Use: https://web-production-88f12.up.railway.app/condiciones
Privacy: https://web-production-88f12.up.railway.app/privacidad
```

**Russian**
- Subtitle: `ИИ-фото для недвижимости`
- Promotional Text: `Меблировка пустых комнат, новое небо и вечерние фото за 30 секунд. 3 фото бесплатно после регистрации.`
- Keywords: `риелтор,недвижимость,стейджинг,фото квартиры,меблировка,hdr,интерьер,ии,объявление,агент`
- Description:
```
Фото, которые продают квартиры, — за 30 секунд.

Загрузите снимок, выберите, что сделать, и скачайте результат:
• Авто-улучшение: свет, HDR, ровные вертикали
• Виртуальная меблировка в 7 стилях
• Убрать хлам и пустая комната
• Новое небо и вечерний свет
• Газон, свежий ремонт, апскейл и своя задача

Сравнивайте «до/после», сохраняйте в «Фото» или отправляйте. На изменённые фото ставится пометка «Виртуальный стейджинг», как требуют порталы.

ОДИН ТАРИФ
• 3 фото бесплатно после регистрации, без карты
• Подписка на неделю: 15 фото каждую неделю
• Отмена в любой момент

Подписка продлевается автоматически каждую неделю, если её не отменить минимум за 24 часа до конца периода. Оплата списывается с вашего Apple Account. Управлять подпиской и отменить её можно в настройках аккаунта App Store.

Условия использования: https://web-production-88f12.up.railway.app/condiciones
Конфиденциальность: https://web-production-88f12.up.railway.app/privacidad
```

### Скриншоты
iPhone **6.9"** (1320 × 2868), симулятор **iPhone 17 Pro Max** → ⌘S. 5 экранов: до/после меблировки, выбор инструмента, вечерний свет, история, экран подписки.

## 6. App Privacy (анкета)

Data Collection → **Yes**; для каждого: *Linked — Yes*, *Tracking — No*, назначение **App Functionality**:
Contact Info → Email Address · User Content → Photos or Videos · Purchases → Purchase History · Identifiers → User ID.

## 7. Данные для ревьюера

1. Зарегистрируйте на сайте аккаунт `appreview@…`, в админке начислите ему **30 кредитов** (бесплатные фото — ревьюер сможет обработать фото без подписки; подписку он проверит в Sandbox).
2. App Store Connect → App Review Information → Sign-In: email и пароль.

**Notes:**
```
Realty Photo AI edits real estate listing photos with AI (virtual staging, HDR, sky replacement, twilight).

How to test:
1. Log in with the demo account (it has free photos).
2. Edit tab → add a room photo → choose "Virtual staging" → Process. The result appears in ~30–60 s with a before/after slider.
3. Subscription: tap the counter at the top right or Account → Subscribe. Weekly auto-renewable subscription (15 photos/week). "Restore purchases" is on the subscription screen and in Account.
4. Account deletion: Account → Delete account.

Photos are processed on our server (EU) via the fal.ai API. No tracking, no ads. Purchases are verified server-side with Apple's signed transactions (StoreKit 2).
```

## 8. Тест подписки (Sandbox)

1. Users and Access → **Sandbox** → создайте тестового пользователя.
2. iPhone: Настройки → App Store → Sandbox Account.
3. Оформите подписку в приложении. В Sandbox неделя длится несколько минут, продления приходят автоматически — счётчик фото обновится, в админке сайта видна подписка «App Store».

> Локальный StoreKit-файл Xcode сервер не примет (подписан не Apple) — тестируйте через Sandbox или TestFlight.

## 9. Загрузка и отправка

1. Xcode → схема **RealtyPhotoAI** → **Any iOS Device (arm64)** → **Product → Archive** → **Distribute App → App Store Connect → Upload**.
2. Версия 1.0 → выберите сборку → в разделе **In-App Purchases and Subscriptions** добавьте подписку `Weekly` (первую подписку проверяют вместе с приложением) → **Add for Review** → **Submit**.

## 10. Частые причины отказа

| Причина | Ответ / что проверить |
|---|---|
| 3.1.2 — нет данных о подписке | На экране подписки есть название, срок (неделя), цена, текст автопродления, ссылки на Условия и Конфиденциальность, «Восстановить покупки». В описании — ссылка на Terms of Use. |
| 3.1.1 | Вся оплата в приложении — через IAP, ссылок на оплату на сайте нет. |
| 4.2 | Приложение нативное: камера, обработка, история, сравнение до/после, сохранение в Фото. |
| 5.1.1(v) | Удаление аккаунта: Account → Delete account. |
| 2.1 | Проверьте, что у демо-аккаунта есть бесплатные фото и сервер отвечает. |
