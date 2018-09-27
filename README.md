
# Automation - Presence

## Why this plugin

HomeKit does a brilliant job detecting when someone is home but it only works with iOS devices.
If you have a guest, you must invite him/her to the Home app (assuming he/she has an iPhone).
HomeKit can tell you if someone is home but can't tell you which room is occupied.

This plugin:
- Support for people presence using devices that are not iPhones.
- Support for "Zones" so you can determine the presence in areas of your house.
- Easier automation by track presence by zone without having to check the value of multiple sensors.
- Support for a "Master presence" sensor to know if there's presence if any of your zones. The true "someone is home".
- State is persisted on disk, so it will survive reboot/restart of homebridge.
- Every change in state is logged on file for future analysis. 

## What is a zone?

This plugin lets you create one or more "zones". A zone can be a room (e.g. `Living Room`), a group of rooms (e.g. `Upstairs`),
a group of devices (e.g. `Guests`) or a group of sensors (e.g. `Someone is in bed`).

You give a "zone" the semantic you like.

Some example of zones:
- **By room**: Living Room, Bedroom, Bathroom
- **By area**: Upstairs, Downstairs, Outside
- **By collection of sensors**: Bedroom bed, Couch (to link multiple sensors together and stop lights to turn on if someone is in bed, for example)
- **By personal devices**, people presence: myself, partner, kid, cleaner, guests

## What are triggers?
For every zone you can define a list of triggers. When one or more triggers are On, the zone is On.

For example, let's assume you have a zone Living room.

Here's the triggers you could have to detect presence:
- Motion sensors
- Audio streaming (turn On the switch when you stream audio and turn the switch Off when you stop streaming; works well with [homebridge-automation-chromecast](https://github.com/paolotremadio/homebridge-automation-chromecast))
- Lights are on (unless they are triggered by motion sensors)
- Media player is playing (e.g. Plex media player, see [homebridge-plex](https://github.com/mpbzh/homebridge-plex))
- Vibration sensors for your furniture (e.g. the Xiaomi/Aqara Vibration sensor, see [homebridge-hue with deconz](https://github.com/dresden-elektronik/deconz-rest-plugin/issues/748))


## About using non-iPhones to track people presence
You can use Bluetooth to track who's home.

For example, you could track personal devices like phones, smart watches, headphones / earphones or fitness trackers.

You could also buy some cheap ["iTag" devices](https://www.gearbest.com/itag-_gear/) or [Tile trackers](https://www.thetileapp.com/) to attach to the dog, your keys, the keys you give to your guests, etc.

You can detect if a Bluetooth device is at home by using my [homebridge-automation-bluetooth-presence](https://github.com/paolotremadio/homebridge-automation-bluetooth-presence) plugin.



## Config 
  
Example config.json:  
  
```json
{
  "accessory": "AutomationPresence",
  "name": "Home Presence",
  "masterPresenceOffDelay": 600,
  "zones": [
    {
      "name": "Zone 1 name",
      "triggers": [
        {
          "name": "Trigger 1 name"
        },
        {
          "name": "Trigger 2 name"
        },
        {
          "name": "Trigger 3 name"
        },
        {
          "name": "..."
        }
      ]
    },
    {
      "name": "Zone 2 name",
      "triggers": [
        {
          "name": "Trigger 1 name"
        },
        {
          "name": "..."
        }
      ]
    },
    {
      "name": "...",
      "triggers": [
        {
          "name": "..."
        }
      ]
    }
  ]
}
```

This accessory will create a switch for every Trigger and a motion sensor for every Zone, including a `Master` motion sensor.

Turning On one or more switches will turn on the Zone they belong to. If one of more Zone is on, the Master switch is On.

Turning on all the switches will turn off the master zone after the `masterPresenceOffDelay` (in seconds). 

## Configuration options  
  
| Attribute | Required | Usage | Example |
|-----------|----------|-------|---------|
| name | Yes | A unique name for the accessory. It will be used as the accessory name in HomeKit. | `Home Presence` |
| masterPresenceOffDelay | No | Number of seconds before turning Off the `Master` sensor, after no presence is detected | `600` (600 seconds, 10 minutes) |
| zones | Yes | A list of one or more Zones and their Triggers | n/a |
