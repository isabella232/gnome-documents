/*
 * Copyright (c) 2011 Red Hat, Inc.
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Tracker = imports.gi.Tracker;

const Application = imports.application;

var ChangeEventType = {
    CHANGED: 0,
    CREATED: 1,
    DELETED: 2
};

const ChangeEvent = new Lang.Class({
    Name: 'ChangeEvent',

    _init: function(type, urn) {
        this.urn = urn;

        if (type == Tracker.NotifierEventType.CREATE)
            this.type = ChangeEventType.CREATED;
        else if (type == Tracker.NotifierEventType.DELETE)
            this.type = ChangeEventType.DELETED;
        else if (type == Tracker.NotifierEventType.UPDATE)
            this.type = ChangeEventType.CHANGED;
    }
});

var TrackerChangeMonitor = new Lang.Class({
    Name: 'TrackerChangeMonitor',

    _init: function() {
        this._notifier = Application.connection.create_notifier();
        this._notifier.signal_subscribe(Gio.DBus.session,
                                        'org.freedesktop.Tracker3.Miner.Files',
                                        null,
                                        'http://tracker.api.gnome.org/ontology/v3/tracker#Documents');
        this._notifier.connect('events', Lang.bind(this, this._onNotifierEvents));
    },

    _onNotifierEvents: function(notifier, service, graph, events) {
        let pendingChanges = {};

        events.forEach(Lang.bind(this,
            function(event) {
                let urn = event.get_urn();
                let changeEvent = new ChangeEvent(event.get_event_type(), urn);
                pendingChanges[urn] = changeEvent;
            }));

        this.emit('changes-pending', pendingChanges);
    }
});
Signals.addSignalMethods(TrackerChangeMonitor.prototype);
