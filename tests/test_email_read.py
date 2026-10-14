# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import pytest

ACCOUNT = 'anna@schule.de'
RAW = b'From: Ben <ben@schule.de>\r\nSubject: Referat\r\nDate: Mon, 1 Jun 2026 08:00:00 +0200\r\n\r\nBis morgen!'


def letter(subject):
    return b'From: Ben <ben@schule.de>\r\nSubject: ' + subject.encode() + b'\r\nDate: Mon, 1 Jun 2026 08:00:00 +0200\r\n\r\nText'


class Imap:
    """A mailbox as a server keeps it: every mail has a UID that stays, and a number that is just its place in the row."""

    calls = []
    box = {}
    seen = set()
    marked = set()
    trash = []
    uidplus = True
    flags_first = False
    folders = [b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren \\Trash) "/" "Trash"']
    noise = None

    def __init__(self, host, port, ssl_context=None, timeout=None):
        pass

    def login(self, user, password):
        pass

    def select(self, folder, readonly=False):
        Imap.calls.append(('select', folder, readonly))
        return 'OK', [b'%d' % len(Imap.box)]

    def capability(self):
        return 'OK', [b'IMAP4rev1 UIDPLUS' if Imap.uidplus else b'IMAP4rev1']

    def list(self):
        return 'OK', list(Imap.folders)

    def bin_names(self):
        return [line.rsplit(b' ', 1)[-1].decode() for line in Imap.folders if b'Trash' in line.split(b')')[0] or b'Papierkorb' in line]

    @staticmethod
    def with_noise(answer):
        """Another app changed a flag in this moment: the server slips in a line about some other mail."""
        line = b'3 (UID 11 FLAGS (\\Seen))'
        if Imap.noise == 'unreadable':
            return [answer[0][0].split(b' RFC822')[0] + b' RFC822 NIL)']
        return [line, *answer] if Imap.noise == 'before' else [*answer, line] if Imap.noise == 'after' else answer

    def uid(self, command, *args):
        Imap.calls.append(('uid', command, *args))
        if command == 'search':
            uids = [b'%d' % uid for uid in Imap.box]
            return 'OK', [b' '.join(uids[:2]), b' '.join(uids[2:])] if Imap.noise == 'split' else [b' '.join(uids)]
        uid = int(args[0])
        if command == 'fetch':
            if uid not in Imap.box:
                return 'OK', [None]
            raw = Imap.box[uid]
            number = list(Imap.box).index(uid) + 1
            flags = b'FLAGS (\\Seen)' if uid in Imap.seen else b'FLAGS ()'
            if 'FLAGS' not in args[1]:
                return 'OK', Imap.with_noise([(b'%d (UID %d RFC822 {%d}' % (number, uid, len(raw)), raw), b')'])
            if Imap.flags_first:
                return 'OK', Imap.with_noise([(b'%d (UID %d %s RFC822 {%d}' % (number, uid, flags, len(raw)), raw), b')'])
            return 'OK', Imap.with_noise([(b'%d (UID %d RFC822 {%d}' % (number, uid, len(raw)), raw), b' ' + flags + b')'])
        if command == 'store':
            (Imap.seen if 'Seen' in args[2] else Imap.marked).add(uid)
            return 'OK', [b'']
        if command == 'copy':
            if args[1] not in self.bin_names():
                return 'NO', [b'no such folder']
            Imap.trash.append(uid)
            return 'OK', [b'']
        if command == 'expunge':
            Imap.box.pop(uid, None)
            Imap.marked.discard(uid)
            return 'OK', [None]
        raise AssertionError(command)

    def expunge(self):
        Imap.calls.append(('expunge',))
        for uid in list(Imap.marked):
            Imap.box.pop(uid, None)
        Imap.marked.clear()
        return 'OK', [b'']

    def numbered(self, *args):
        raise AssertionError('message numbers move when a mail is expunged, every command has to go by UID')

    search = fetch = store = copy = numbered

    def logout(self):
        pass


@pytest.fixture
def mailbox(monkeypatch):
    from app import email_service

    Imap.calls, Imap.seen, Imap.marked, Imap.trash = [], set(), set(), []
    Imap.uidplus, Imap.flags_first, Imap.noise = True, False, None
    Imap.folders = [b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren \\Trash) "/" "Trash"']
    Imap.box = {7: RAW}
    monkeypatch.setattr(email_service.imaplib, 'IMAP4_SSL', Imap)
    monkeypatch.setattr(email_service, 'load_email_config',
                        lambda: {'accounts': [{'email': ACCOUNT, 'provider': 'custom', 'password': 'geheim'}]})
    monkeypatch.setattr(email_service, 'get_provider_settings',
                        lambda provider, address: {'imap_host': 'imap.schule.de', 'imap_port': 993})
    return email_service


@pytest.fixture
def client(mailbox):
    from app import app as hub

    hub.app.config['TESTING'] = True
    with hub.app.test_client() as client:
        client.get(f'/hub?token={hub.API_TOKEN}')
        yield client


def test_opening_a_mail_changes_nothing_on_the_server(client):
    response = client.get(f'/api/email/message/{ACCOUNT}/7')
    assert response.status_code == 200
    assert response.get_json()['email']['subject'] == 'Referat'
    assert ('select', 'INBOX', True) in Imap.calls
    assert not [call for call in Imap.calls if call[:2] == ('uid', 'store')]


def test_marking_as_read_needs_a_post(client):
    response = client.post(f'/api/email/message/{ACCOUNT}/7/read', headers={'Origin': 'http://localhost'})
    assert response.status_code == 200
    assert ('uid', 'store', '7', '+FLAGS', '\\Seen') in Imap.calls


def test_a_foreign_page_cannot_mark_mail_as_read(client):
    response = client.post(f'/api/email/message/{ACCOUNT}/7/read', headers={'Origin': 'http://evil.example'})
    assert response.status_code == 403
    assert Imap.calls == []


@pytest.mark.parametrize('msg_id', ['7 +FLAGS', '1:*', 'x'])
def test_only_plain_message_numbers_are_marked(client, msg_id):
    assert client.post(f'/api/email/message/{ACCOUNT}/{msg_id}/read').status_code == 400
    assert Imap.calls == []


@pytest.mark.parametrize('flags_first', [False, True])
def test_the_list_hands_out_uids_newest_first_and_finds_the_flags_wherever_they_stand(mailbox, flags_first):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite'), 205: letter('Dritte')}
    Imap.seen = {40}
    Imap.flags_first = flags_first
    listed = mailbox.fetch_emails(ACCOUNT, 'INBOX', 2)['emails']
    assert [(mail['id'], mail['subject'], mail['read']) for mail in listed] == [('205', 'Dritte', False), ('40', 'Zweite', True)]


def test_an_empty_mailbox_is_an_empty_list(mailbox):
    Imap.box = {}
    assert mailbox.fetch_emails(ACCOUNT, 'INBOX', 20) == {'success': True, 'emails': []}


def test_after_a_mail_is_deleted_the_ids_of_the_others_still_mean_the_same_mails(mailbox):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite'), 205: letter('Dritte'), 206: letter('Vierte')}
    listed = {mail['subject']: mail['id'] for mail in mailbox.fetch_emails(ACCOUNT, 'INBOX', 20)['emails']}

    assert mailbox.delete_email(ACCOUNT, listed['Zweite'])['success']
    assert sorted(Imap.box) == [11, 205, 206] and Imap.trash == [40]

    # The page still holds the ids from before. They must reach the same mails, not their neighbours.
    assert mailbox.get_email_detail(ACCOUNT, listed['Dritte'])['email']['subject'] == 'Dritte'
    assert mailbox.mark_email_read(ACCOUNT, listed['Vierte'])['success'] and Imap.seen == {206}
    assert mailbox.delete_email(ACCOUNT, listed['Dritte'])['success']
    assert sorted(Imap.box) == [11, 206]


def test_deleting_leaves_alone_what_another_app_marked_for_deletion(mailbox):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite'), 205: letter('Dritte')}
    Imap.marked = {11}
    assert mailbox.delete_email(ACCOUNT, '205')['success']
    assert sorted(Imap.box) == [11, 40] and ('expunge',) not in Imap.calls


def test_a_server_that_cannot_expunge_single_mails_still_deletes(mailbox):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite')}
    Imap.uidplus = False
    assert mailbox.delete_email(ACCOUNT, '40')['success']
    assert sorted(Imap.box) == [11] and ('expunge',) in Imap.calls


def test_a_mail_that_is_gone_is_reported_as_gone(mailbox):
    assert mailbox.get_email_detail(ACCOUNT, '999') == {'success': False, 'error': 'Could not fetch email', 'gone': True}


@pytest.mark.parametrize('noise', ['before', 'after'])
def test_a_line_about_another_mail_in_the_answer_changes_nothing(mailbox, noise):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite'), 205: letter('Dritte')}
    Imap.noise = noise
    listed = mailbox.fetch_emails(ACCOUNT, 'INBOX', 20)['emails']
    assert [(mail['id'], mail['subject'], mail['read']) for mail in listed] == [('205', 'Dritte', False), ('40', 'Zweite', False), ('11', 'Erste', False)]
    assert mailbox.get_email_detail(ACCOUNT, '40')['email']['subject'] == 'Zweite'
    assert mailbox.get_email_detail(ACCOUNT, '999').get('gone') is True


def test_a_mail_the_server_cannot_read_is_not_taken_for_gone(mailbox):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite')}
    Imap.noise = 'unreadable'
    assert mailbox.get_email_detail(ACCOUNT, '40') == {'success': False, 'error': 'Could not fetch email'}
    assert mailbox.fetch_emails(ACCOUNT, 'INBOX', 20) == {'success': True, 'emails': []}
    assert mailbox.get_email_detail(ACCOUNT, '999').get('gone') is True


def test_a_search_answer_in_several_lines_is_read_whole(mailbox):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite'), 205: letter('Dritte'), 206: letter('Vierte')}
    Imap.noise = 'split'
    assert [mail['id'] for mail in mailbox.fetch_emails(ACCOUNT, 'INBOX', 20)['emails']] == ['206', '205', '40', '11']


def test_the_bin_is_the_folder_the_server_marks_as_one(mailbox):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite')}
    Imap.folders = [b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren \\Trash) "/" "Gel&APY-scht"']
    assert mailbox.delete_email(ACCOUNT, '40')['success']
    assert ('uid', 'copy', '40', '"Gel&APY-scht"') in Imap.calls and sorted(Imap.box) == [11] and Imap.trash == [40]


def test_a_bin_with_a_space_in_its_name_is_found_too(mailbox, monkeypatch):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite')}
    Imap.folders = [b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren) "/" "Deleted Items"']
    monkeypatch.setattr(Imap, 'bin_names', lambda self: ['"Deleted Items"'])
    assert mailbox.delete_email(ACCOUNT, '40')['success'] and Imap.trash == [40]


def test_without_a_bin_the_mail_stays(mailbox):
    Imap.box = {11: letter('Erste'), 40: letter('Zweite')}
    Imap.folders = [b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren) "/" "Ablage"']
    assert mailbox.delete_email(ACCOUNT, '40') == {'success': False, 'error': 'No trash folder'}
    assert sorted(Imap.box) == [11, 40] and Imap.marked == set()
