/* eslint-disable */
import React, { ExoticComponent, useState } from 'react';

import {Redirect, Route, Switch} from 'react-router-dom';
import {Button, Form, Input, message, Modal} from 'antd';

import './App.less';
import ApplicationServices, {setDebugInfo} from './lib/services/ApplicationServices';
import {CenteredSpin, GlobalError, handleError, Preloader} from './lib/components/components';
import {reloadPage} from './lib/commons/utils';
import {User} from './lib/services/model';
import { PRIVATE_PAGES, PUBLIC_PAGES, SELFHOSTED_PAGES} from './navigation';

import { ApplicationPage, emailIsNotConfirmedMessageConfig, SlackChatWidget } from './Layout';
import { PaymentPlanStatus } from 'lib/services/billing';
import { OnboardingTour } from 'lib/components/OnboardingTour/OnboardingTour';
import { initializeAllStores } from 'stores/_initializeAllStores';

enum AppLifecycle {
    LOADING, //Application is loading
    REQUIRES_LOGIN, //Login form is displayed
    APP, //Application
    ERROR //Global error (maintenance)
}

type AppState = {
    lifecycle: AppLifecycle;
    globalErrorDetails?: string;
    extraControls?: React.ReactNode;
    user?: User;
    paymentPlanStatus?: PaymentPlanStatus;
};

export const initializeApplication = async (
  services: ApplicationServices = ApplicationServices.get()
): Promise<{
  user: User;
  paymentPlanStatus: PaymentPlanStatus;
}> => {
  await services.init();
  const { user } = await services.userService.waitForUser();
  setDebugInfo('user', user);
  if (user) {
    services.analyticsService.onUserKnown(user);
  }

  await initializeAllStores();

  let paymentPlanStatus: PaymentPlanStatus | undefined = undefined;
  if (user && services.features.billingEnabled) {
    paymentPlanStatus = new PaymentPlanStatus();
    await paymentPlanStatus.init(
      services.activeProject,
      services.backendApiClient
    );
  }

  return { user, paymentPlanStatus };
};

const LOGIN_TIMEOUT = 5000;
export default class App extends React.Component<{}, AppState> {
    private readonly services: ApplicationServices;

    constructor(props: any, context: any) {
        super(props, context);
        this.services = ApplicationServices.get();
        setDebugInfo('applicationServices', this.services, false);
        this.state = {
            lifecycle: AppLifecycle.LOADING,
            extraControls: null
        };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        this.services.analyticsService.onGlobalError(error);
    }

    public async componentDidMount() {
        try {
            const { user, paymentPlanStatus } = await initializeApplication(
              this.services
            );

            this.setState({
              lifecycle: user ? AppLifecycle.APP : AppLifecycle.REQUIRES_LOGIN,
              user: user,
              paymentPlanStatus: paymentPlanStatus
            });

            if (user) {
              const email =
                await this.services.userService.getUserEmailStatus();
              email.needsConfirmation &&
                !email.isConfirmed &&
                message.warn(emailIsNotConfirmedMessageConfig);
            }
        } catch (error) {
            console.error('Failed to initialize ApplicationServices', error);
            if (this.services.analyticsService) {
                this.services.analyticsService.onGlobalError(error, true);
            } else {
                console.error("Failed to send error to analytics service, it's not defined yet");
            }
            this.setState({lifecycle: AppLifecycle.ERROR});
            return;
        }

        window.setTimeout(() => {
            if (this.state.lifecycle == AppLifecycle.LOADING) {
                this.services.analyticsService.onGlobalError(new Error('Login timeout'));
                this.setState({lifecycle: AppLifecycle.ERROR, globalErrorDetails: 'Timeout'});
            }
        }, LOGIN_TIMEOUT);
    }

    private getRenderComponent() {
        switch (this.state.lifecycle) {
            case AppLifecycle.REQUIRES_LOGIN:
                let pages = this.services.showSelfHostedSignUp() ? SELFHOSTED_PAGES : PUBLIC_PAGES;
                return <>
                    <Switch>
                        {pages.map((route) => {
                            let Component = route.component as ExoticComponent;
                            return (
                                <Route
                                    key={route.getPrefixedPath().join('')}
                                    path={route.getPrefixedPath()}
                                    exact
                                    render={(routeProps) => {
                                        this.services.analyticsService.onPageLoad({
                                            pagePath: routeProps.location.key || '/unknown'
                                        });
                                        document.title = route.pageTitle;
                                        return <Component {...(routeProps as any)} />;
                                    }}
                                />
                            );
                        })}
                        <Redirect key="rootRedirect" to="/"/>
                    </Switch>
                </>;
            case AppLifecycle.APP:
                return <>
                    {this.appLayout()}
                    {<SlackChatWidget />}
                    </>;
            case AppLifecycle.ERROR:
                return <GlobalError/>;
            case AppLifecycle.LOADING:
                return <Preloader/>;
        }
    }

    public render() {
        return <React.Suspense fallback={<CenteredSpin/>}>{this.getRenderComponent()}</React.Suspense>;
    }


    appLayout() {
        const routes = PRIVATE_PAGES.map((route) => {
            const Component = route.component as ExoticComponent;
            return <Route
                    key={route.pageTitle}
                    path={route.getPrefixedPath()}
                    exact={true}
                    render={(routeProps) => {
                        this.services.analyticsService.onPageLoad({
                            pagePath: routeProps.location.hash
                        });
                        document.title = route.pageTitle;
                        return route.doNotWrap ?
                            <Component {...(routeProps as any)} /> :
                            <ApplicationPage user={this.state.user} plan={this.state.paymentPlanStatus} page={route} {...routeProps} />;
                    }}
                />;
        });

        routes.push(<Redirect key="dashboardRedirect" from="*" to="/dashboard"/>);

        const extraForms = <OnboardingTour />;
        if (this.services.userService.getUser().forcePasswordChange) {
            return (
                <SetNewPassword
                    onCompleted={async () => {
                        reloadPage();
                    }}
                />
            );
        }
        return (
            <>
                <Switch>{routes}</Switch>
                {extraForms}
            </>
        );
    }
}

function SetNewPassword({onCompleted}: { onCompleted: () => Promise<void> }) {
    let [loading, setLoading] = useState(false);
    let services = ApplicationServices.get();
    let [form] = Form.useForm();
    return (
        <Modal
            title="Please, set a new password"
            visible={true}
            closable={false}
            footer={
                <>
                    <Button
                        onClick={() => {
                            services.userService.removeAuth(reloadPage);
                        }}
                    >
                        Logout
                    </Button>
                    <Button
                        type="primary"
                        loading={loading}
                        onClick={async () => {
                            setLoading(true);
                            let values;
                            try {
                                values = await form.validateFields();
                            } catch (e) {
                                //error will be displayed on the form, not need for special handling
                                setLoading(false);
                                return;
                            }

                            try {
                                let newPassword = values['password'];
                                await services.userService.changePassword(newPassword);
                                await services.userService.login(services.userService.getUser().email, newPassword);
                                let user = (await services.userService.waitForUser()).user;
                                user.forcePasswordChange = false;
                                //await services.userService.update(user);
                                await onCompleted();
                            } catch (e) {
                                if ('auth/requires-recent-login' === e.code) {
                                    services.userService.removeAuth(() => {
                                        reloadPage();
                                    });
                                } else {
                                    handleError(e);
                                }
                            } finally {
                                setLoading(false);
                            }
                        }}
                    >
                        Set new password
                    </Button>
                </>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item
                    name="password"
                    label="Password"
                    rules={[
                        {
                            required: true,
                            message: 'Please input your password!'
                        }
                    ]}
                    hasFeedback
                >
                    <Input.Password/>
                </Form.Item>

                <Form.Item
                    name="confirm"
                    label="Confirm Password"
                    dependencies={['password']}
                    hasFeedback
                    rules={[
                        {
                            required: true,
                            message: 'Please confirm your password!'
                        },
                        ({getFieldValue}) => ({
                            validator(rule, value) {
                                if (!value || getFieldValue('password') === value) {
                                    return Promise.resolve();
                                }
                                return Promise.reject('The two passwords that you entered do not match!');
                            }
                        })
                    ]}
                >
                    <Input.Password/>
                </Form.Item>
            </Form>
        </Modal>
    );
}
