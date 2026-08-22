Configuration AP2StudentBaseline
{
    param
    (
        [Parameter(Mandatory = $true)]
        [System.String]
        $TenantId,

        [Parameter(Mandatory = $true)]
        [System.String[]]
        $AccessTokens
    )

    Import-DscResource -ModuleName Microsoft365DSC -ModuleVersion '1.26.715.1'

    Node localhost
    {
        AADGroup RetainedManagedWindowsEndpoints
        {
            DisplayName     = 'AP2 retained managed Windows endpoints'
            MailNickname    = 'ap2-retained-managed-windows-endpoints'
            Description     = 'Standing scope for AP2 retained managed Windows endpoints.'
            SecurityEnabled = $true
            MailEnabled     = $false
            Ensure          = 'Present'
            TenantId        = $TenantId
            AccessTokens    = $AccessTokens
        }

        AADConditionalAccessPolicy RequireMfaForAllUsers
        {
            DisplayName                              = 'AP2 baseline - Require MFA for all users'
            State                                    = 'enabled'
            IncludeApplications                      = @('All')
            ExcludeApplications                      = @()
            IncludeUserActions                       = @()
            AuthenticationContexts                   = @()
            IncludeUsers                             = @('All')
            ExcludeUsers                             = @()
            IncludeGroups                            = @()
            ExcludeGroups                            = @()
            IncludeRoles                             = @()
            ExcludeRoles                             = @()
            ClientAppTypes                           = @('all')
            UserRiskLevels                           = @()
            SignInRiskLevels                         = @()
            GrantControlOperator                     = 'OR'
            BuiltInControls                          = @('mfa')
            TermsOfUse                               = @()
            CustomAuthenticationFactors              = @()
            ApplicationEnforcedRestrictionsIsEnabled = $false
            CloudAppSecurityIsEnabled                = $false
            SecureSignInSessionIsEnabled             = $false
            SignInFrequencyIsEnabled                 = $false
            PersistentBrowserIsEnabled               = $false
            DisableResilienceDefaultsIsEnabled       = $false
            Ensure                                   = 'Present'
            TenantId                                 = $TenantId
            AccessTokens                             = $AccessTokens
        }

        AADConditionalAccessPolicy BlockLegacyAuthentication
        {
            DisplayName                              = 'AP2 baseline - Block legacy authentication'
            State                                    = 'enabled'
            IncludeApplications                      = @('All')
            ExcludeApplications                      = @()
            IncludeUserActions                       = @()
            AuthenticationContexts                   = @()
            IncludeUsers                             = @('All')
            ExcludeUsers                             = @()
            IncludeGroups                            = @()
            ExcludeGroups                            = @()
            IncludeRoles                             = @()
            ExcludeRoles                             = @()
            ClientAppTypes                           = @('exchangeActiveSync', 'other')
            UserRiskLevels                           = @()
            SignInRiskLevels                         = @()
            GrantControlOperator                     = 'OR'
            BuiltInControls                          = @('block')
            TermsOfUse                               = @()
            CustomAuthenticationFactors              = @()
            ApplicationEnforcedRestrictionsIsEnabled = $false
            CloudAppSecurityIsEnabled                = $false
            SecureSignInSessionIsEnabled             = $false
            SignInFrequencyIsEnabled                 = $false
            PersistentBrowserIsEnabled               = $false
            DisableResilienceDefaultsIsEnabled       = $false
            Ensure                                   = 'Present'
            TenantId                                 = $TenantId
            AccessTokens                             = $AccessTokens
        }

        AADConditionalAccessPolicy BlockDeviceCodeFlow
        {
            DisplayName                              = 'AP2 baseline - Block device code flow'
            State                                    = 'enabled'
            IncludeApplications                      = @('All')
            ExcludeApplications                      = @()
            IncludeUserActions                       = @()
            AuthenticationContexts                   = @()
            IncludeUsers                             = @('All')
            ExcludeUsers                             = @()
            IncludeGroups                            = @()
            ExcludeGroups                            = @()
            IncludeRoles                             = @()
            ExcludeRoles                             = @()
            ClientAppTypes                           = @('all')
            UserRiskLevels                           = @()
            SignInRiskLevels                         = @()
            GrantControlOperator                     = 'OR'
            BuiltInControls                          = @('block')
            TransferMethods                          = 'deviceCodeFlow'
            TermsOfUse                               = @()
            CustomAuthenticationFactors              = @()
            ApplicationEnforcedRestrictionsIsEnabled = $false
            CloudAppSecurityIsEnabled                = $false
            SecureSignInSessionIsEnabled             = $false
            SignInFrequencyIsEnabled                 = $false
            PersistentBrowserIsEnabled               = $false
            DisableResilienceDefaultsIsEnabled       = $false
            Ensure                                   = 'Present'
            TenantId                                 = $TenantId
            AccessTokens                             = $AccessTokens
        }

        IntuneWindowsUpdateForBusinessRingUpdateProfileWindows10 MonthlyQualityUpdates
        {
            DisplayName                             = 'AP2 retained endpoints - Monthly quality updates'
            Description                             = 'Standing AP2 retained-endpoint quality/security update baseline.'
            RoleScopeTagIds                         = @('0')
            MicrosoftUpdateServiceAllowed           = $true
            DriversExcluded                         = $true
            QualityUpdatesDeferralPeriodInDays      = 3
            FeatureUpdatesDeferralPeriodInDays      = 0
            AllowWindows11Upgrade                   = $false
            QualityUpdatesPaused                    = $false
            FeatureUpdatesPaused                    = $false
            BusinessReadyUpdatesOnly                = 'userDefined'
            DeliveryOptimizationMode                = 'userDefined'
            PrereleaseFeatures                      = 'userDefined'
            SkipChecksBeforeRestart                 = $false
            AutomaticUpdateMode                     = 'windowsDefault'
            UserPauseAccess                         = 'disabled'
            UserWindowsUpdateScanAccess             = 'disabled'
            UpdateNotificationLevel                 = 'restartWarningsOnly'
            AutoRestartNotificationDismissal        = 'notConfigured'
            FeatureUpdatesRollbackWindowInDays      = 10
            DeadlineForFeatureUpdatesInDays         = 14
            DeadlineForQualityUpdatesInDays         = 7
            DeadlineGracePeriodInDays               = 2
            PostponeRebootUntilAfterDeadline        = $false
            Assignments                             = @(
                MSFT_DeviceManagementConfigurationPolicyAssignments
                {
                    dataType                                   = '#microsoft.graph.groupAssignmentTarget'
                    groupDisplayName                           = 'AP2 retained managed Windows endpoints'
                    deviceAndAppManagementAssignmentFilterType = 'none'
                }
            )
            DependsOn                               = '[AADGroup]RetainedManagedWindowsEndpoints'
            Ensure                                  = 'Present'
            TenantId                                = $TenantId
            AccessTokens                            = $AccessTokens
        }

        IntuneWindowsUpdateForBusinessFeatureUpdateProfileWindows10 Windows11_24H2
        {
            DisplayName                                       = 'AP2 retained endpoints - Windows 11 24H2'
            Description                                       = 'Hold retained AP2 endpoints on supported Windows 11 24H2 until a deliberate baseline change.'
            RoleScopeTagIds                                   = @('0')
            FeatureUpdateVersion                              = 'Windows 11, version 24H2'
            InstallLatestWindows10OnWindows11IneligibleDevice = $false
            InstallFeatureUpdatesOptional                     = $false
            Assignments                                       = @(
                MSFT_DeviceManagementConfigurationPolicyAssignments
                {
                    dataType                                   = '#microsoft.graph.groupAssignmentTarget'
                    groupDisplayName                           = 'AP2 retained managed Windows endpoints'
                    deviceAndAppManagementAssignmentFilterType = 'none'
                }
            )
            DependsOn                                         = '[AADGroup]RetainedManagedWindowsEndpoints'
            Ensure                                            = 'Present'
            TenantId                                          = $TenantId
            AccessTokens                                      = $AccessTokens
        }
    }
}
