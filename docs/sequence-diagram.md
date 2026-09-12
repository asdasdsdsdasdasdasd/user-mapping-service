# Main flow: POST /api/v1/user-mappings

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as NestJS API
    participant R as Redis
    participant DB as MySQL 8

    C->>API: POST /api/v1/user-mappings { id1, id2 }
    API->>API: Validate payload (class-validator)

    alt payload invalid
        API-->>C: 400 Bad Request (field messages)
    else payload valid
        API->>R: GET id:<sha256(id1, id2)>
        alt cache hit
            R-->>API: userID
            API-->>C: 200 { userID }
        else cache miss or Redis unavailable
            API->>DB: SELECT user_id WHERE id1 = ? AND id2 = ?
            alt row exists
                DB-->>API: existing userID
                API->>R: SET cache (TTL)
                API-->>C: 200 { userID }
            else row does not exist
                API->>R: SET lock:<sha256(id1, id2)> <token> NX PX 5000
                Note over API,R: best effort - if Redis is down the lock is simply skipped
                API->>DB: SELECT (re-check, another request may have inserted the row)
                API->>DB: INSERT (id1, id2, uuid v4)
                alt unique index uq_user_mappings_id1_id2 violated
                    DB-->>API: duplicate key error
                    API->>DB: SELECT the row that won the race
                end
                API->>R: SET cache (TTL)
                API->>R: EVAL release lock (only if the token is still ours)
                API-->>C: 200 { userID }
            end
        end
    end
```

## Notes

* **MySQL is the source of truth.** Redis only shortens the path: a cache hit skips
  the database read, and the lock keeps concurrent requests out of the insert path.
* **The unique index is the guarantee.** Every insert is a single statement, and the
  database rejects the loser of a race with a duplicate key error. The loser then
  reads the winning row and returns its `userID`, so both callers receive the same
  answer and exactly one row exists.
* **Redis failures are not request failures.** Every Redis call is wrapped so that a
  timeout, an outage or an empty `REDIS_URL` degrades to "no cache, no lock" while the
  request still succeeds through MySQL.
* **The table is append-only**, so a cached `userID` can never become stale: a row is
  written once and never updated or deleted by the application.
