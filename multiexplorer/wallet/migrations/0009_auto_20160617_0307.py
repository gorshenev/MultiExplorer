# -*- coding: utf-8 -*-
# Generated by Django 1.9.2 on 2016-06-17 03:07
from __future__ import unicode_literals

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0008_failedlogin'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='failedlogin',
            options={'get_latest_by': 'time'},
        ),
    ]
