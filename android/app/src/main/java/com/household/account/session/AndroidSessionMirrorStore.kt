package com.household.account.session

import android.content.Context
import com.household.account.security.AndroidKeystoreEncryptedStore
import org.json.JSONObject

class AndroidSessionMirrorStore(context: Context) : SessionMirrorStore {
    private val encrypted = AndroidKeystoreEncryptedStore(context, "native_session_mirror.v1", "household.session.mirror.aes256gcm.v1")
    override fun load(): SessionMirrorState {
        val value = encrypted.read() ?: return SessionMirrorState()
        return try { SessionMirrorJson.decode(value) } catch (_: Exception) {
            encrypted.clear()
            SessionMirrorState()
        }
    }
    override fun replace(state: SessionMirrorState) = encrypted.write(SessionMirrorJson.encode(state))
}

internal object SessionMirrorJson {
    fun encode(state: SessionMirrorState): String = JSONObject().apply {
        put("schemaVersion", state.schemaVersion)
        put("generation", state.generation)
        state.snapshot?.let { snapshot ->
            put("snapshot", JSONObject().apply {
                put("householdId", snapshot.householdId)
                put("memberId", snapshot.memberId)
                put("memberName", snapshot.memberName)
                put("generation", snapshot.generation)
                put("sourceVersion", snapshot.sourceVersion)
                put("updatedAtEpochMillis", snapshot.updatedAtEpochMillis)
            })
        }
        state.transition?.let { journal ->
            put("transition", JSONObject().apply {
                put("fromGeneration", journal.fromGeneration)
                put("toGeneration", journal.toGeneration)
            })
        }
    }.toString()
    fun decode(value: String): SessionMirrorState {
        val root = JSONObject(value)
        require(root.getInt("schemaVersion") == 1)
        val generation = root.getLong("generation")
        require(generation >= 0)
        val snapshot = root.optJSONObject("snapshot")?.let {
            SessionMirrorSnapshot(it.getString("householdId"), it.getString("memberId"), it.getString("memberName"),
                it.getLong("generation"), it.getInt("sourceVersion"), it.getLong("updatedAtEpochMillis")).also { snapshot ->
                require(snapshot.householdId.isNotBlank() && snapshot.memberId.isNotBlank() && snapshot.memberName.isNotBlank())
                require(snapshot.generation == generation && generation > 0 && snapshot.sourceVersion > 0)
            }
        }
        val journal = root.optJSONObject("transition")?.let {
            SessionTransitionJournal(it.getLong("fromGeneration"), it.getLong("toGeneration")).also { journal ->
                require(journal.fromGeneration == generation && journal.toGeneration > generation)
            }
        }
        return SessionMirrorState(generation = generation, snapshot = snapshot, transition = journal)
    }
}
