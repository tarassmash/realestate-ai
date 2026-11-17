# Realty Photo AI — iOS

Нативное приложение на SwiftUI для того же сервиса, что и сайт (общий аккаунт и баланс).

- Xcode 26+, iOS 17+, iPhone, портрет
- Без сторонних зависимостей (SwiftUI, StoreKit 2, PhotosUI)
- Языки: English, Español, Русский

## Структура

```
RealtyPhotoAI/
  App/            точка входа, сессия (AppModel), адрес сервера (AppConfig)
  Networking/     APIClient — cookie-сессия, ошибки сервера
  Models/         модели API, инструменты и инструкции для ИИ (Presets — синхронны с public/presets.js)
  Features/
    Auth/         вход и регистрация (галочка согласия с условиями)
    Editor/       выбор фото (галерея/камера), инструменты, очередь обработки, до/после
    History/      история обработок
    Account/      баланс, покупки, приглашения, смена пароля, удаление аккаунта
    Store/        StoreKit 2: пакеты фото, проверка покупки на сервере
  Components/     слайдер до/после, общие элементы, камера, «Поделиться»
  Utilities/      уменьшение фото, пометка «Виртуальный стейджинг», сохранение в Фото
  Resources/      иконка, цвета, переводы, Privacy Manifest
```

Папка `RealtyPhotoAI` подключена к проекту как синхронизированная (Xcode 16+): новые файлы, добавленные в неё, попадают в сборку автоматически.

## Сервер

| Метод | Назначение |
|---|---|
| `GET /api/iap/products` | ID товаров App Store и количество кредитов |
| `POST /api/iap/apple` | `{ signedTransaction }` — проверка подписи Apple (цепочка до Apple Root CA G3), привязка к аккаунту по `appAccountToken`, начисление без дублей |
| `POST /api/iap/notifications` | App Store Server Notifications V2 — при `REFUND`/`REVOKE` кредиты списываются |

Переменная `APPLE_BUNDLE_ID` на сервере должна совпадать с Bundle ID в Xcode (по умолчанию `com.realtyphotoai.app`).

Публикация в App Store — см. [APP_STORE.md](APP_STORE.md).
