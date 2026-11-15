import { useEffect, useState, type FormEvent } from 'react'

type Profile = { id: string; email: string; name: string; timezone: string }

export function ProfilePage({ id }: { id: string }) {
    const [profile, setProfile] = useState<Profile | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        fetch(`/api/users/${id}`)
            .then((response) => response.json() as Promise<Profile>)
            .then(setProfile)
    }, [id])

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        setSaving(true)
        const response = await fetch(`/api/users/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: form.get('name'), timezone: form.get('timezone') }),
        })
        setProfile((await response.json()) as Profile)
        setSaving(false)
    }

    if (!profile) {
        return <p>Loading profile...</p>
    }

    return (
        <form onSubmit={save}>
            <p>{profile.email}</p>
            <input name="name" defaultValue={profile.name} />
            <input name="timezone" defaultValue={profile.timezone} />
            <button type="submit" disabled={saving}>Save</button>
        </form>
    )
}
